// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable-next-line:no-require-imports no-var-requires
const sudo = require('sudo-prompt');

import * as fs from 'fs';
import { injectable } from 'inversify';
import * as path from 'path';
import * as vscode from 'vscode';
import { IInterpreterService, InterpreterType } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { STANDARD_OUTPUT_CHANNEL } from '../constants';
import { noop } from '../core.utils';
import { ITerminalServiceFactory } from '../terminal/types';
import { ExecutionInfo, IConfigurationService, IOutputChannel } from '../types';

@injectable()
export abstract class ModuleInstaller {
    constructor(protected serviceContainer: IServiceContainer) { }
    public async installModule(name: string, resource?: vscode.Uri): Promise<void> {
        const executionInfo = await this.getExecutionInfo(name, resource);
        const terminalService = this.serviceContainer.get<ITerminalServiceFactory>(ITerminalServiceFactory).getTerminalService(resource);

        const executionInfoArgs = await this.processInstallArgs(executionInfo.args, resource);
        if (executionInfo.moduleName) {
            const configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
            const settings = configService.getSettings(resource);
            const args = ['-m', executionInfo.moduleName].concat(executionInfoArgs);

            const pythonPath = settings.pythonPath;

            const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
            const currentInterpreter = await interpreterService.getActiveInterpreter(resource);

            if (!currentInterpreter || currentInterpreter.type !== InterpreterType.Unknown) {
                await terminalService.sendCommand(pythonPath, args);
            } else if (settings.globalModuleInstallation) {
                if (await this.isPathWritableAsync(path.dirname(pythonPath))) {
                    await terminalService.sendCommand(pythonPath, args);
                } else {
                    this.elevatedInstall(pythonPath, args);
                }
            } else {
                await terminalService.sendCommand(pythonPath, args.concat(['--user']));
            }
        } else {
            await terminalService.sendCommand(executionInfo.execPath!, executionInfoArgs);
        }
    }
    public abstract isSupported(resource?: vscode.Uri): Promise<boolean>;
    protected abstract getExecutionInfo(moduleName: string, resource?: vscode.Uri): Promise<ExecutionInfo>;
    private async processInstallArgs(args: string[], resource?: vscode.Uri): Promise<string[]> {
        const indexOfPylint = args.findIndex(arg => arg.toUpperCase() === 'PYLINT');
        if (indexOfPylint === -1) {
            return args;
        }

        // If installing pylint on python 2.x, then use pylint~=1.9.0
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const currentInterpreter = await interpreterService.getActiveInterpreter(resource);
        if (currentInterpreter && currentInterpreter.version_info && currentInterpreter.version_info[0] === 2) {
            const newArgs = [...args];
            // This command could be sent to the terminal, hence '<' needs to be escaped for UNIX.
            newArgs[indexOfPylint] = '"pylint<2.0.0"';
            return newArgs;
        }
        return args;
    }
    private async isPathWritableAsync(directoryPath: string): Promise<boolean> {
        const filePath = `${directoryPath}${path.sep}___vscpTest___`;
        return new Promise<boolean>(resolve => {
            fs.open(filePath, fs.constants.O_CREAT | fs.constants.O_RDWR, (error, fd) => {
                if (!error) {
                    fs.close(fd, (e) => {
                        fs.unlink(filePath, noop);
                    });
                }
                return resolve(!error);
            });
        });
    }

    private elevatedInstall(execPath: string, args: string[]) {
        const options = {
            name: 'VS Code Python'
        };
        const outputChannel = this.serviceContainer.get<vscode.OutputChannel>(IOutputChannel, STANDARD_OUTPUT_CHANNEL);
        const command = `"${execPath.replace(/\\/g, '/')}" ${args.join(' ')}`;

        outputChannel.appendLine('');
        outputChannel.appendLine(`[Elevated] ${command}`);

        sudo.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(error);
            } else {
                outputChannel.show();
                if (stdout) {
                    outputChannel.appendLine('');
                    outputChannel.append(stdout);
                }
                if (stderr) {
                    outputChannel.appendLine('');
                    outputChannel.append(`Warning: ${stderr}`);
                }
            }
        });
    }
}
