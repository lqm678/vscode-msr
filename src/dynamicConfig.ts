import * as vscode from 'vscode';
import path = require('path');
import fs = require('fs');
import os = require('os');
import { outputDebug, enableColorAndHideCommandLine, outputError, runCommandInTerminal, MessageLevel, outputKeyInfo, clearOutputChannel, sendCmdToTerminal, RunCmdTerminalName, showOutputChannel } from './outputUtils';
import { getNoDuplicateStringSet, replaceTextByRegex, runCommandGetInfo, replaceText, quotePaths, isNullOrEmpty, toMinGWPath, toCygwinPath, toLinuxPathOnWindows, toLinuxPathsOnWindows } from './utils';
import { createRegex } from './regexUtils';
import { isNullOrUndefined } from 'util';
import { stringify } from 'querystring';
import { IsDebugMode, HomeFolder, IsWindows, SearchTextHolderReplaceRegex } from './constants';
import { FindType } from './enums';
import { MsrExe, MsrExePath } from './checkTool';

const SplitPathsRegex = /\s*[,;]\s*/;
const SplitPathGroupsRegex = /\s*;\s*/;
const FolderToPathPairRegex = /(\w+\S+?)\s*=\s*(\S+.+)$/;

const CookCmdDocUrl = 'https://github.com/qualiu/vscode-msr/blob/master/README.md#command-shortcuts';

let MyConfig: DynamicConfig;

export function removeSearchTextForCommandLine(cmd: string): string {
    return cmd.replace(/(\s+-c)\s+Search\s+%~?1/, '$1');
}

export class DynamicConfig {
    public RootConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('msr');
    public RootFolder: string = ".";

    // Temp toggle enable/disable finding definition and reference
    public IsEnabledFindingDefinitionAndReference: boolean = true;

    public ClearTerminalBeforeExecutingCommands: boolean = false;
    public ShowInfo: boolean = false;
    public IsQuiet: boolean = false;
    public IsDebug: boolean = false;
    public DescendingSortForConsoleOutput: boolean = false;
    public DescendingSortForVSCode: boolean = false;

    public DefaultMaxSearchDepth: number = 16;
    public NeedSortResults: boolean = false;

    public ReRunCmdInTerminalIfCostLessThan: number = 3.3;

    public ConfigAndDocFilesRegex: RegExp = new RegExp('to-load');
    public CodeAndConfigAndDocFilesRegex: RegExp = new RegExp('to-load');
    public DefaultConstantsRegex: RegExp = new RegExp('to-load');
    public SearchAllFilesWhenFindingReferences: boolean = false;
    public SearchAllFilesWhenFindingDefinitions: boolean = false;
    public GetSearchTextHolderInCommandLine: RegExp = /\s+-c\s+.*?%~?1/;
    public DisabledFileExtensionRegex: RegExp = new RegExp('to-load');
    public DisabledRootFolderNameRegex: RegExp = new RegExp('to-load');
    public DisableFindDefinitionFileExtensionRegex: RegExp = new RegExp('to-load');
    public FindDefinitionInAllFolders: boolean = true;
    public FindReferencesInAllRootFolders: boolean = true;

    public IsFindDefinitionEnabled: boolean = true;
    public IsFindReferencesEnabled: boolean = true;

    public ExcludeFoldersFromSettings: Set<string> = new Set<string>();

    public InitProjectCmdAliasForNewTerminals: boolean = true;
    public OverwriteProjectCmdAliasForNewTerminals: boolean = true;
    public AutoMergeSkipFolders: boolean = true;

    public UseExtraPathsToFindReferences: boolean = false;
    public UseExtraPathsToFindDefinition: boolean = true;

    public toggleEnableFindingDefinitionAndReference() {
        this.IsEnabledFindingDefinitionAndReference = !this.IsEnabledFindingDefinitionAndReference;
        this.update();

        outputDebug('Toggled: msr.enable.definition = ' + this.IsFindDefinitionEnabled);
        outputDebug('Toggled: msr.enable.reference = ' + this.IsFindReferencesEnabled);
    }

    public update() {
        this.RootConfig = vscode.workspace.getConfiguration('msr');
        this.IsFindDefinitionEnabled = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'enable.definition') === 'true' && this.IsEnabledFindingDefinitionAndReference;
        this.IsFindReferencesEnabled = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'enable.reference') === 'true' && this.IsEnabledFindingDefinitionAndReference;

        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.RootFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        this.UseExtraPathsToFindDefinition = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'findDefinition.useExtraPaths') === "true";
        this.UseExtraPathsToFindReferences = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'findReference.useExtraPaths') === "true";
        this.FindDefinitionInAllFolders = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'definition.searchAllRootFolders') === "true";
        this.FindReferencesInAllRootFolders = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'reference.searchAllRootFolders') === "true";

        this.ClearTerminalBeforeExecutingCommands = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'clearTerminalBeforeExecutingCommands') === 'true';
        this.InitProjectCmdAliasForNewTerminals = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'initProjectCmdAliasForNewTerminals') === 'true';
        this.OverwriteProjectCmdAliasForNewTerminals = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'overwriteProjectCmdAliasForNewTerminals') === 'true';
        this.AutoMergeSkipFolders = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'autoMergeSkipFolders') === 'true';
        this.ShowInfo = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'showInfo') === 'true';
        this.IsQuiet = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'quiet') === 'true';
        this.IsDebug = IsDebugMode || getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'debug') === 'true';
        this.DescendingSortForConsoleOutput = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'descendingSortForConsoleOutput') === 'true';
        this.DescendingSortForVSCode = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'descendingSortForVSCode') === 'true';
        this.DefaultMaxSearchDepth = parseInt(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.maxSearchDepth') || '0');
        this.NeedSortResults = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.sortResults') === 'true';
        this.ReRunCmdInTerminalIfCostLessThan = Number(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'reRunSearchInTerminalIfCostLessThan') || '3.3');
        this.ConfigAndDocFilesRegex = new RegExp(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.configAndDocs') as string || '\\.(json|xml|ini|ya?ml|md)|readme', 'i');
        this.CodeAndConfigAndDocFilesRegex = new RegExp(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.codeAndConfigDocs') as string || '\\.(cs\\w*|nuspec|config|c[px]*|h[px]*|java|scala|py|go|php|vue|tsx?|jsx?|json|ya?ml|xml|ini|md)$|readme', 'i');
        this.DefaultConstantsRegex = new RegExp(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.isConstant') as string);
        this.SearchAllFilesWhenFindingReferences = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.searchAllFilesForReferences') === 'true';
        this.SearchAllFilesWhenFindingDefinitions = getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'default.searchAllFilesForDefinitions') === 'true';
        this.DisabledRootFolderNameRegex = createRegex(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'disable.projectRootFolderNamePattern') as string);

        this.DisabledFileExtensionRegex = createRegex(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'disable.extensionPattern') as string, 'i', true);
        this.DisableFindDefinitionFileExtensionRegex = createRegex(getOverrideConfigByPriority([this.RootFolder, 'default', ''], 'disable.findDef.extensionPattern') as string, 'i', true);

        this.ExcludeFoldersFromSettings.clear();
        if (this.AutoMergeSkipFolders) {
            this.ExcludeFoldersFromSettings = this.getExcludeFolders('search');
            this.getExcludeFolders('files').forEach(a => this.ExcludeFoldersFromSettings.add(a));
        }
    }

    public shouldSkipFinding(findType: FindType, currentFilePath: string): boolean {
        if ((findType === FindType.Definition && !this.IsFindDefinitionEnabled) || (findType === FindType.Reference && !this.IsFindReferencesEnabled)) {
            outputDebug('Disabled by `msr.enable.' + findType + '` or temporarily toggled enable/disable by `msr.tmpToggleEnableForFindDefinitionAndReference`');
            return true;
        }

        const parsedFile = path.parse(currentFilePath);
        const extension = parsedFile.ext.replace(/^\./, '').toLowerCase() || 'default';
        let shouldSkip = 0;

        if (MyConfig.DisabledFileExtensionRegex.test(extension)) {
            outputDebug('Disabled for `*.' + extension + '` file in configuration: `msr.disable.extensionPattern`');
            shouldSkip += 1;
        }

        if (FindType.Definition === findType && MyConfig.DisableFindDefinitionFileExtensionRegex.test(extension)) {
            outputDebug('Disabled for `*.' + extension + '` file in configuration: `msr.disable.findDef.extensionPattern`');
            shouldSkip += 1;
        }

        const rootFolderName = getRootFolderName(currentFilePath) || '';
        if (MyConfig.DisabledRootFolderNameRegex.test(rootFolderName)) {
            outputDebug('Disabled for this git root folder in configuration: `msr.disable.projectRootFolderNamePattern` = ' + MyConfig.DisabledRootFolderNameRegex.source);
            shouldSkip += 1;
        }

        return shouldSkip > 0;
    }

    private getExcludeFolders(keyName: string): Set<string> {
        let textSet = new Set<string>();
        let config = vscode.workspace.getConfiguration(keyName);
        if (!config || !config.exclude) {
            return textSet;
        }

        const trimRegex = /^[\s\*/]+|[\s\*/]+$/;
        try {
            let map = new Map(Object.entries(config.exclude));
            map.forEach((value, key, _m) => {
                if (value) {
                    let text = replaceTextByRegex(key, trimRegex, '');
                    if (/^[\w-]+$/.test(text)) {
                        textSet.add(text);
                    }
                }
            });
        } catch (error) {
            outputDebug('Failed to get exclude folder from `' + keyName + '.exclude`: ' + error.toString());
        }

        outputDebug('Got ' + textSet.size + ' folders of `' + keyName + '.exclude`: ' + Array.from(textSet).join(' , '));
        return textSet;
    }
}

export function getConfig(reload: boolean = false): DynamicConfig {
    if (MyConfig && !reload) {
        return MyConfig;
    }

    if (!MyConfig) {
        MyConfig = new DynamicConfig();
    }

    MyConfig.update();

    outputDebug('----- vscode-msr configuration loaded: ' + new Date().toLocaleString() + ' -----');
    printConfigInfo(MyConfig.RootConfig);
    return MyConfig;
}

export function getRootFolder(filePath: string): string | undefined {
    if (isNullOrEmpty(filePath)) {
        return undefined;
    }

    const folderUri = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!folderUri || !folderUri.uri || !folderUri.uri.fsPath) {
        return undefined;
    }

    return folderUri.uri.fsPath;
}

export function getRootFolderName(filePath: string): string | undefined {
    const folder = getRootFolder(filePath);
    return isNullOrUndefined(folder) ? undefined : path.parse(folder).base;
}

export function getRootFolders(currentFilePath: string): string | undefined {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length < 1) {
        return undefined;
    }

    let rootFolderSet = new Set<string>().add(getRootFolder(currentFilePath) || '');
    vscode.workspace.workspaceFolders.forEach(a => rootFolderSet.add(a.uri.fsPath));
    rootFolderSet.delete('');
    return Array.from(rootFolderSet).join(',');
}

export function getRootFolderExtraOptions(rootFolderName: string): string {
    let folderExtraOptions = (MyConfig.RootConfig.get(rootFolderName + '.extraOptions') as string || '').trim();
    if (folderExtraOptions.length > 0) {
        folderExtraOptions += ' ';
    }

    return folderExtraOptions;
}

export function getOverrideConfigByPriority(priorityPrefixList: string[], configNameTail: string, allowEmpty: boolean = true): string {
    const RootConfig = vscode.workspace.getConfiguration('msr');
    for (let k = 0; k < priorityPrefixList.length; k++) {
        const name = (priorityPrefixList[k].length > 0 ? priorityPrefixList[k] + '.' : priorityPrefixList[k]) + configNameTail;
        let valueObject = RootConfig.get(name);
        if (valueObject === undefined || valueObject === null) {
            continue;
        }

        const valueText = String(valueObject);
        if (valueText.length > 0 || allowEmpty) {
            return valueText;
        }
    }

    return '';
}

export function getOverrideOrDefaultConfig(mappedExtOrFolderName: string, suffix: string, allowEmpty: boolean = true): string {
    return getOverrideConfigByPriority([mappedExtOrFolderName, 'default'], suffix, allowEmpty);
}

export function getSearchPathOptions(
    codeFilePath: string,
    mappedExt: string,
    isFindingDefinition: boolean,
    useExtraSearchPathsForReference: boolean = true,
    useExtraSearchPathsForDefinition: boolean = true,
    useSkipFolders: boolean = true,
    usePathListFiles: boolean = true): string {

    const rootConfig = getConfig().RootConfig;
    const rootFolderName = getRootFolderName(codeFilePath) || '';
    const rootPaths = !MyConfig.FindReferencesInAllRootFolders
        ? getRootFolder(codeFilePath)
        : getRootFolders(codeFilePath);

    const subName = isFindingDefinition ? 'definition' : 'reference';
    let skipFoldersPattern = getOverrideConfigByPriority([rootFolderName + '.' + subName + '.' + mappedExt, rootFolderName + '.' + subName, rootFolderName, mappedExt, 'default'], 'skipFolders');
    skipFoldersPattern = mergeSkipFolderPattern(skipFoldersPattern);

    const skipFolderOptions = useSkipFolders && skipFoldersPattern.length > 1 ? ' --nd "' + skipFoldersPattern + '"' : '';
    if ((isFindingDefinition && !useExtraSearchPathsForDefinition) || (!isFindingDefinition && !useExtraSearchPathsForReference)) {
        return isNullOrUndefined(rootPaths) || rootPaths.length === 0
            ? '-p ' + quotePaths(isFindingDefinition ? path.parse(codeFilePath).dir : codeFilePath)
            : '-rp ' + quotePaths(rootPaths) + skipFolderOptions;
    }

    let extraSearchPathSet = getExtraSearchPathsOrFileLists('default.extraSearchPaths', rootFolderName);
    getExtraSearchPathsOrFileLists('default.extraSearchPathGroups', rootFolderName).forEach(a => extraSearchPathSet.add(a));
    splitPathList(rootConfig.get(rootFolderName + '.extraSearchPaths') as string).forEach((a => extraSearchPathSet.add(a)));

    let extraSearchPathFileListSet = getExtraSearchPathsOrFileLists('default.extraSearchPathListFiles', rootFolderName);
    getExtraSearchPathsOrFileLists('default.extraSearchPathListFileGroups', rootFolderName).forEach(a => extraSearchPathFileListSet.add(a));
    splitPathList(rootConfig.get(rootFolderName + '.extraSearchPathListFiles') as string).forEach((a => extraSearchPathFileListSet.add(a)));

    const thisTypeExtraSearchPaths = !isFindingDefinition ? new Set<string>() : getExtraSearchPathsOrFileLists(mappedExt + '.extraSearchPaths', rootFolderName);
    const thisTypeExtraSearchPathListFiles = !isFindingDefinition ? new Set<string>() : getExtraSearchPathsOrFileLists(mappedExt + '.extraSearchPathListFiles', rootFolderName);

    let searchPathSet = new Set<string>();
    (rootPaths || (isFindingDefinition ? path.parse(codeFilePath).dir : codeFilePath)).split(',').forEach(a => searchPathSet.add(a));
    thisTypeExtraSearchPaths.forEach(a => searchPathSet.add(a));
    extraSearchPathSet.forEach(a => searchPathSet.add(a));
    searchPathSet = getNoDuplicateStringSet(searchPathSet);

    let pathsText = Array.from(searchPathSet).join(',').replace(/"/g, '');
    pathsText = quotePaths(pathsText);

    let pathListFileSet = new Set<string>(thisTypeExtraSearchPathListFiles);
    extraSearchPathFileListSet.forEach(a => pathListFileSet.add(a));
    pathListFileSet = getNoDuplicateStringSet(extraSearchPathFileListSet);
    let pathFilesText = Array.from(pathListFileSet).join(',').replace(/"/g, '');
    pathFilesText = quotePaths(pathFilesText);

    const readPathListOptions = usePathListFiles && pathListFileSet.size > 0 ? ' -w "' + pathFilesText + '"' : '';
    return isNullOrEmpty(rootPaths)
        ? '-p ' + pathsText + readPathListOptions + skipFolderOptions
        : '-rp ' + pathsText + readPathListOptions + skipFolderOptions;
}

export function getExtraSearchPathsOrFileLists(configKey: string, folderName: string): Set<string> {
    let extraSearchPaths = new Set<string>();
    const RootConfig = getConfig().RootConfig || vscode.workspace.getConfiguration('msr');
    const extraPathObject = RootConfig.get(configKey);
    if (!extraPathObject) {
        return extraSearchPaths;
    }

    const valueType = typeof extraPathObject;
    let extraSearchPathGroups: string[] = [];
    if (valueType === 'string') {
        extraSearchPathGroups = (extraPathObject as string || '').trim().split(SplitPathGroupsRegex).filter(a => a.length > 0);
    } else {
        const pathArray = extraPathObject as string[];
        if (pathArray) {
            pathArray.forEach(a => {
                a.trim().split(SplitPathGroupsRegex).filter(a => a.length > 0).forEach(g => extraSearchPathGroups.push(a));
            });
        }
    }

    let folderNameToPathMap = new Map<string, string>();
    extraSearchPathGroups.forEach(a => {
        const m = FolderToPathPairRegex.exec(a);
        if (m) {
            folderNameToPathMap.set(m[1], m[2].trim());
        } else {
            a.split(SplitPathsRegex).forEach(p => {
                extraSearchPaths.add(p.trim());
            });
        }
    });

    const specificPaths = folderNameToPathMap.get(folderName) || '';
    splitPathList(specificPaths).forEach(a => extraSearchPaths.add(a));
    return getNoDuplicateStringSet(extraSearchPaths);
}

function splitPathList(pathListText: string) {
    let extraSearchPaths = new Set<string>();
    if (!pathListText) {
        return extraSearchPaths;
    }

    pathListText.split(SplitPathsRegex).forEach(a => {
        extraSearchPaths.add(a.trim());
    });

    extraSearchPaths = getNoDuplicateStringSet(extraSearchPaths);
    return extraSearchPaths;
}

export function printConfigInfo(config: vscode.WorkspaceConfiguration) {
    outputDebug('msr.enable.definition = ' + config.get('enable.definition'));
    outputDebug('msr.enable.reference = ' + config.get('enable.reference'));
    outputDebug('msr.enable.findingCommands = ' + config.get('enable.findingCommands'));
    outputDebug('msr.quiet = ' + config.get('quiet'));
    outputDebug('msr.debug = ' + config.get('debug'));
    outputDebug('msr.disable.extensionPattern = ' + config.get('disable.extensionPattern'));
    outputDebug('msr.disable.findDef.extensionPattern = ' + config.get('disable.findDef.extensionPattern'));
    outputDebug('msr.disable.projectRootFolderNamePattern = ' + config.get('disable.projectRootFolderNamePattern'));
    outputDebug('msr.initProjectCmdAliasForNewTerminals = ' + config.get('initProjectCmdAliasForNewTerminals'));
    outputDebug('msr.autoMergeSkipFolders = ' + config.get('autoMergeSkipFolders'));
}

export function cookCmdShortcutsOrFile(
    currentFilePath: string,
    useProjectSpecific: boolean,
    writeToEachFile: boolean,
    newTerminal: vscode.Terminal | undefined = undefined,
    newTerminalShellPath: string = '',
    dumpOtherCmdAlias: boolean = false) {
    if (!newTerminal) {
        clearOutputChannel();
    }

    // https://code.visualstudio.com/docs/editor/integrated-terminal#_configuration
    const shellConfig = vscode.workspace.getConfiguration('terminal.integrated.shell');
    const shellExe = !shellConfig ? '' : shellConfig.get(IsWindows ? 'windows' : 'linux') as string;
    const isWindowsTerminal = IsWindows && (!newTerminal || !/bash/i.test(newTerminal.name));
    const isLinuxOnWindows = IsWindows && !isWindowsTerminal;
    // MinGW: "terminal.integrated.shell.windows": "C:\\Program Files\\Git\\bin\\bash.exe"
    // Cygwin: "terminal.integrated.shell.windows": "D:\\cygwin64\\bin\\bash.exe"
    const isMinGW = IsWindows && !isWindowsTerminal && shellExe.includes('Git\\bin\\bash.exe');
    const isCygwin = IsWindows && !isWindowsTerminal && /cygwin/i.test(shellExe);

    const rootConfig = getConfig().RootConfig;
    const saveFolder = newTerminal ? os.tmpdir() : rootConfig.get('cmdAlias.saveFolder') as string || HomeFolder;
    const rootFolderName = getRootFolderName(currentFilePath) || '';
    if (isNullOrEmpty(rootFolderName) && !newTerminal) {
        useProjectSpecific = false;
    }

    const [cmdAliasMap, oldCmdCount, commands] = getCommandAliasMap(rootFolderName, useProjectSpecific, writeToEachFile, dumpOtherCmdAlias, newTerminal);
    const fileName = (useProjectSpecific ? rootFolderName + '.' : '') + 'msr-cmd-alias' + (isWindowsTerminal ? '.doskeys' : '.bashrc');
    const cmdAliasFile = path.join(saveFolder, fileName);
    const quotedFile = quotePaths(cmdAliasFile);
    if (isWindowsTerminal) {
        const aliasBody = 'doskey /macros 2>&1 | msr -PI -t "^(%1)"'; // $2 $3 $4 $5 $6 $7 $8 $9';
        if (!newTerminal) {
            cmdAliasMap.set('alias', getCommandAliasText('alias', aliasBody, false, true, writeToEachFile));
            const updateDoskeyText = (writeToEachFile ? '' : 'update-doskeys=') + 'doskey /MACROFILE=' + quotedFile;
            cmdAliasMap.set('update-doskeys', updateDoskeyText);
        }

        cmdAliasMap.set('malias', getCommandAliasText('malias', aliasBody, false, true, writeToEachFile));
    } else if (!isWindowsTerminal) {
        cmdAliasMap.set('malias', getCommandAliasText('malias', 'alias | msr -PI -t "^\\s*alias\\s+($1)"', true, false, writeToEachFile));
    }

    const useFullPathsBody = getPathCmdAliasBody(true, cmdAliasFile, false);
    cmdAliasMap.set('use-wp', getCommandAliasText('use-wp', useFullPathsBody, false, isWindowsTerminal, writeToEachFile, false, false));
    const useRelativePathsBody = getPathCmdAliasBody(false, cmdAliasFile, false);
    cmdAliasMap.set('use-rp', getCommandAliasText('use-rp', useRelativePathsBody, false, isWindowsTerminal, writeToEachFile, false, false));

    const outFullPathsBody = getPathCmdAliasBody(true, cmdAliasFile, true, true);
    cmdAliasMap.set('out-fp', getCommandAliasText('out-fp', outFullPathsBody, false, isWindowsTerminal, writeToEachFile, false, false));
    const outRelativePathsBody = getPathCmdAliasBody(false, cmdAliasFile, true, false);
    cmdAliasMap.set('out-rp', getCommandAliasText('out-rp', outRelativePathsBody, false, isWindowsTerminal, writeToEachFile, false, false));

    let skipWritingScriptNames = new Set<string>(['use-wp', 'use-rp', 'out-rp', 'out-fp', 'alias']);
    if (!isWindowsTerminal) {
        skipWritingScriptNames.add('malias');
    }

    let allText = '';
    let failureCount = 0;
    const singleScriptFolder = path.join(saveFolder, 'cmdAlias');
    let failedToCreateSingleScriptFolder = false;
    if (writeToEachFile && !fs.existsSync(singleScriptFolder)) {
        try {
            fs.mkdirSync(singleScriptFolder);
        } catch (err) {
            failedToCreateSingleScriptFolder = true;
            outputError('\n' + 'Failed to make single script folder: ' + singleScriptFolder + ' Error: ' + err.toString());
        }
    }

    const sortedKeys = Array.from(cmdAliasMap.keys()).sort();
    sortedKeys.forEach(key => {
        const value = cmdAliasMap.get(key) || '';
        if (writeToEachFile) {
            if (!failedToCreateSingleScriptFolder && !skipWritingScriptNames.has(key) && (dumpOtherCmdAlias || key.startsWith('find'))) {
                const singleScriptPath = path.join(singleScriptFolder, isWindowsTerminal ? key + '.cmd' : key);
                try {
                    fs.writeFileSync(singleScriptPath, value.trimRight() + (isWindowsTerminal ? '\r\n' : '\n'));
                } catch (err) {
                    failureCount++;
                    outputError('\n' + 'Failed to write single command alias script file:' + singleScriptPath + ' Error: ' + err.toString());
                }
            }
        } else {
            allText += value + (isWindowsTerminal ? '\r\n\r\n' : '\n\n');
        }
    });

    if (writeToEachFile) {
        if (!failedToCreateSingleScriptFolder && failureCount < cmdAliasMap.size) {
            outputCmdAliasGuide(saveFolder);
            let setPathCmd = 'msr -z "' + (isWindowsTerminal ? '%PATH%' : '$PATH') + '" -ix "' + singleScriptFolder + '" >' + (isWindowsTerminal ? 'nul' : '/dev/null') + ' && ';
            if (isWindowsTerminal) {
                setPathCmd += 'SET "PATH=%PATH%;' + singleScriptFolder + '"';
            } else {
                setPathCmd += 'export PATH=$PATH:' + singleScriptFolder;
            }

            runCmdInTerminal(setPathCmd, true);
            if (isWindowsTerminal) {
                runCmdInTerminal('where find-def.cmd', false);
                runCmdInTerminal('where find-def', false);
            } else {
                runCmdInTerminal('chmod +x ' + singleScriptFolder + (dumpOtherCmdAlias ? '/*' : '/find*'), false);
                runCmdInTerminal('whereis find-def', false);
                runCmdInTerminal('whereis find-ref', false);
            }
        }

        if (failureCount > 0) {
            outputKeyInfo('Total = ' + cmdAliasMap.size + ', failures = ' + failureCount + ', made ' + (cmdAliasMap.size - failureCount) + ' command alias/doskey script files saved in: ' + singleScriptFolder);
        } else {
            outputKeyInfo('Successfully made ' + cmdAliasMap.size + ' command alias/doskey script files and saved in: ' + singleScriptFolder);
        }
    } else {
        let existedText = '';
        try {
            if (fs.existsSync(cmdAliasFile)) {
                existedText = fs.readFileSync(cmdAliasFile).toString();
            }
        } catch (err) {
            outputError('\n' + 'Failed to read file: ' + cmdAliasFile + ' Error: ' + err.toString());
        }

        const hasChanged = allText !== existedText;
        if (hasChanged) {
            if (!isNullOrEmpty(existedText) && newTerminal && !MyConfig.OverwriteProjectCmdAliasForNewTerminals) {
                outputDebug(`Found msr.OverwriteProjectCmdAliasForNewTerminals = false, Skip writing temp command shortcuts file: ${cmdAliasFile}`);
            } else {
                try {
                    fs.writeFileSync(cmdAliasFile, allText);
                } catch (err) {
                    outputError('\n' + 'Failed to save command alias file: ' + cmdAliasFile + ' Error: ' + err.toString());
                    return;
                }
            }
        }

        if (!newTerminal || (newTerminal.name === RunCmdTerminalName && MyConfig.IsDebug)) {
            outputCmdAliasGuide('');
            const existingInfo = isWindowsTerminal ? ' (merged existing = ' + oldCmdCount + ')' : '';
            outputKeyInfo((hasChanged ? 'Successfully made ' : 'Already has same ') + commands.length + existingInfo + ' command alias/doskey file at: ' + cmdAliasFile);
            outputKeyInfo('To more freely use them (like in scripts or nested command line pipe): Press `F1` search `msr Cook` and choose cooking script files. (You can make menu `msr.cookCmdAliasFiles` visible).');
        }

        const slashQuotedFile = quotedFile === cmdAliasFile ? cmdAliasFile : '\\"' + cmdAliasFile + '\\"';
        const shortcutsExample = ' shortcuts like find-all-def find-pure-ref find-doc find-small , use-rp use-wp out-fp out-rp etc. See detail like: alias find-def or malias use-wp .';
        const disableDocText = ' You can disable msr.initProjectCmdAliasForNewTerminals in user settings. More detail: ' + CookCmdDocUrl;
        let canRunShowDef = true;
        if (IsWindows) {
            if (newTerminal) {
                let cmd = '';
                // Powershell PSReadLine module is not compatible with doskey
                if (/Powershell/i.test(newTerminal.name + newTerminalShellPath)) {
                    canRunShowDef = false;
                    const quotedFileForPS = quotedFile === cmdAliasFile ? cmdAliasFile : '`"' + cmdAliasFile + '`"';
                    const setEnvCmd = MsrExe === 'msr' ? '' : "$env:Path = $env:Path + ';" + path.dirname(MsrExe) + "'; ";
                    cmd = setEnvCmd + 'cmd /k ' + '"doskey /MACROFILE=' + quotedFileForPS + ' && doskey /macros | msr -t find-def -x msr --nx use- --nt out- -e \\s+-+\\w+\\S* -PM'
                        + ' & echo. & echo Type exit or powershell if you want to back to Powershell without ' + commands.length + shortcutsExample
                        + disableDocText
                        + ' | msr -aPA -e .+ -ix powershell -t m*alias^|find\\S+^|out-\\S+^|use-\\S+^|msr.init\\S+'
                        + '"';
                    runCmdInTerminal(cmd, true); //, MsrExe === 'msr');
                } else if (/cmd/i.test(newTerminal.name + newTerminalShellPath)) {
                    checkSetPathBeforeRunDoskeyAlias('doskey /MACROFILE=' + quotedFile, false);
                } else if (/bash/i.test(newTerminal.name + newTerminalShellPath)) {
                    if (isMinGW) {
                        const exeFolder = toMinGWPath(MsrExePath).replace(/[^/]+$/, '');
                        const setEnvCmd = 'export PATH=$PATH:' + exeFolder;
                        checkSetPathBeforeRunDoskeyAlias('source ' + quotePaths(toMinGWPath(cmdAliasFile)), false, setEnvCmd);
                    } else if (isCygwin) {
                        const exeFolder = toCygwinPath(MsrExePath).replace(/[^/]+$/, '');
                        let setEnvCmd = 'export PATH=$PATH:' + exeFolder;
                        const cygwinFolder = toCygwinPath(path.dirname(shellExe));
                        const envPath = process.env['PATH'] || '';
                        if (!isNullOrEmpty(envPath) && !envPath.includes(cygwinFolder) && !isNullOrEmpty(cygwinFolder)) {
                            setEnvCmd += ':' + cygwinFolder;
                        }

                        checkSetPathBeforeRunDoskeyAlias('source ' + quotePaths(toCygwinPath(cmdAliasFile)), false, setEnvCmd);
                    }
                } else {
                    outputDebug('\n' + 'Not supported terminal: ' + newTerminal.name + ', shellExe = ' + shellExe);
                    fs.unlinkSync(cmdAliasFile);
                    return;
                }
            }
            else {
                checkSetPathBeforeRunDoskeyAlias('doskey /MACROFILE="' + cmdAliasFile + '"', false);
                const regCmd = 'REG ADD "HKEY_CURRENT_USER\\Software\\Microsoft\\Command Processor" /v Autorun /d "DOSKEY /MACROFILE=' + slashQuotedFile + '" /f';
                runCmdInTerminal(regCmd, true);
                runCmdInTerminal('alias update', true);
            }
        } else {
            checkSetPathBeforeRunDoskeyAlias('source ' + quotedFile, true);
            if (!newTerminal) {
                runCmdInTerminal('msr -p ~/.bashrc 2>/dev/null -x ' + quotedFile + ' -M && echo "source ' + slashQuotedFile + '" >> ~/.bashrc');
            }
        }

        if (canRunShowDef || !newTerminal) {
            runCmdInTerminal('echo Now you can use ' + commands.length
                + shortcutsExample
                + disableDocText + ' | msr -aPA -e .+ -x ' + commands.length + ' -t "find-\\S+|out-\\S+|use-\\S+|msr.init\\S+|(m*alias [\\w-]+)"', true);
        }

        if (!newTerminal) {
            showOutputChannel(true, true);
        }
    }

    function getPathCmdAliasBody(useWorkspacePath: boolean, sourceAliasFile: string, onlyForOutput: boolean = false, outputFullPath: boolean = false, useTmpFile: boolean = false): string {
        let sourceFilePath = toLinuxPathOnWindows(sourceAliasFile, isCygwin, isMinGW);
        const tmpSaveFile = !useTmpFile ? quotePaths(sourceFilePath) : quotePaths(sourceFilePath + `-${useWorkspacePath ? "full" : "relative"}.tmp`);
        const replaceHead = `msr -p ` + tmpSaveFile;
        const andText = isWindowsTerminal ? " & " : " ; ";
        const copyCmd = (isWindowsTerminal ? `copy /y ` : `cp `) + quotePaths(sourceFilePath) + ` ` + tmpSaveFile;
        const loadCmdAliasCmd = (isWindowsTerminal ? "doskey /MACROFILE=" : "source ") + tmpSaveFile;

        const rootFolder = MyConfig.RootFolder;
        const findDefinitionPathOptions = getSearchPathOptions(rootFolder, "all", true, MyConfig.UseExtraPathsToFindReferences, MyConfig.UseExtraPathsToFindDefinition, false, false);
        const findReferencesPathOptions = getSearchPathOptions(rootFolder, "all", false, MyConfig.UseExtraPathsToFindReferences, MyConfig.UseExtraPathsToFindDefinition, false, false);
        const pathsForDefinition = toLinuxPathsOnWindows(findDefinitionPathOptions.replace(/\s*-r?p\s+/, ""), isCygwin, isMinGW);
        const pathsForOthers = toLinuxPathsOnWindows(findReferencesPathOptions.replace(/\s*-r?p\s+/, ""), isCygwin, isMinGW);
        if (pathsForDefinition.includes(" ") || pathsForOthers.includes(" ")) {
            return "echo Skip due to whitespace found in workspace root paths. | msr -aPA -t .+";
        }

        const commonSkip = ` --nt "use-[wr]p|out-[fr]p|find-ndp"`;
        if (isWindowsTerminal) {
            return getWindowsBody();
        }

        return getLinuxBody(true, true, false) + andText + getLinuxBody(false, false, true);

        function getWindowsBody(): string {
            const headCopyCmd = useTmpFile ? copyCmd + andText : "";
            const tailLoadCmd = andText + loadCmdAliasCmd;
            if (onlyForOutput) {
                if (outputFullPath) {
                    return headCopyCmd
                        + replaceHead
                        + ` -x find-` + ` --nt "use-[wr]p|out-[fr]p|find-ndp|\\s+-W\\s+"`
                        + ` -t "(=msr -rp.*?\\S+)"`
                        + ` -o "\\1 -W"`
                        + ` -R -c Output full path.`
                        + tailLoadCmd;
                } else {
                    return headCopyCmd
                        + replaceHead + ` -x find-`
                        + ` -t "(=msr -rp.*?)\\s+-W\\s+"`
                        + ` -o "\\1 "` + commonSkip
                        + ` -R -c Output relative path.`
                        + tailLoadCmd;
                }
            }

            if (useWorkspacePath) {
                return headCopyCmd
                    + replaceHead + ` -t "find-\\S*def"` + commonSkip
                    + ` -x "msr -rp . "`
                    + ` -o "msr -rp ${pathsForDefinition} "`
                    + ` -R -c Use workspace paths for all find-def + find-xxx-def`
                    + andText + replaceHead + ` -t "find-" --nt "use-[wr]p|out-[fr]p|find-ndp|find-\\S*def" `
                    + ` -x "msr -rp . "`
                    + ` -o "msr -rp ${pathsForOthers} "`
                    + ` -R -c Use workspace paths for others like find-ref or find-doc etc.`
                    + tailLoadCmd;
            } else {
                // Skip case of workspace root path contains whitespace
                // + andText + replaceHead + ` -x find- -t "msr\\s+-rp\\s+(\\.?\\w+\\S+|([\\"']).+?\\2)" -o "msr -rp ." -R -c Use relative paths for all find-xxx`
                return headCopyCmd
                    + replaceHead + commonSkip
                    + ` -x "find-"` + ` -t "msr\\s+-rp\\s+\\S+"`
                    + ` -o "msr -rp ."`
                    + ` -R -c Use relative paths for all find-xxx`
                    + tailLoadCmd;
            }
        }

        function getLinuxBody(forFunction: boolean, copySourceFile: boolean, addLoadCmd: boolean) {
            const headCopyCmd = copySourceFile && useTmpFile ? copyCmd + andText : "";
            const tailLoadCmd = addLoadCmd ? andText + loadCmdAliasCmd : "";
            const functionCondition = ` -b "alias find-.*?=.*?function"` + ` -Q "^\\s*\\}"`;
            if (onlyForOutput) {
                if (outputFullPath) {
                    const findText = forFunction
                        ? functionCondition + ` --nt "use-[wr]p|out-[fr]p|find-ndp|\\s+-W\\s+"` + ` -t "^(\\s*msr -rp.*?\\S+)"`
                        : ` --nt "use-[wr]p|out-[fr]p|find-ndp|\\s+-W\\s+"` + ` -t "(alias find-.*?=.*?msr -rp.*?\\S+)"`;
                    return headCopyCmd
                        + replaceHead + findText + ` -o "\\1 -W"` + ` -R -c Output full path` + (forFunction ? " for functions" : "")
                        + tailLoadCmd;
                } else {
                    const findText = forFunction
                        ? functionCondition + ` --nt "use-[wr]p|out-[fr]p|find-ndp"` + ` -t "^(\\s*msr -rp.*?)\\s+-W\\s+(.*)"`
                        : ` --nt "use-[wr]p|out-[fr]p|find-ndp"` + ` -t "(alias find-.*?=.*?msr -rp.*?)\\s+-W\\s+(.*)"`;
                    return headCopyCmd
                        + replaceHead + findText + ` -o "\\1 \\2"` + ` -R -c Output relative path` + (forFunction ? " for functions" : "")
                        + tailLoadCmd;
                }
            }

            if (useWorkspacePath) {
                if (forFunction) {
                    // for functions on Linux / Cygwin / MinGW
                    return headCopyCmd + replaceHead + functionCondition + ` --nt "use-[wr]p|out-[fr]p|find-ndp"`
                        + ` -t "msr -rp . "`
                        + ` -o "msr -rp ${pathsForDefinition} "`
                        + ` -R -c Use workspace paths for all find-def + find-xxx-def functions`
                        + andText + replaceHead + functionCondition + ` --nt "use-[wr]p|out-[fr]p|find-ndp|find-\\S*def"`
                        + ` -t "msr -rp . "`
                        + ` -o "msr -rp ${pathsForOthers} "`
                        + ` -R -c Use workspace paths for other functions like find-ref or find-doc etc.`
                        + tailLoadCmd;
                }
                else {
                    // for single line alias on Linux / Cygwin / MinGW
                    return headCopyCmd + replaceHead + ` --nt "use-[wr]p|out-[fr]p|find-ndp"`
                        + ` -t "(alias find-\\S*def=.*?)msr -rp . "`
                        + ` -o "\\1msr -rp ${pathsForDefinition} "`
                        + ` -R -c Use workspace paths for all find-def + find-xxx-def`
                        + andText + replaceHead + ` --nt "use-[wr]p|out-[fr]p|find-ndp|find-\\S*def"`
                        + ` -t "(alias find.*?=.*?)msr -rp . " `
                        + ` -o "\\1msr -rp ${pathsForOthers} "`
                        + ` -R -c Use workspace paths for others like find-ref or find-doc etc.`
                        + tailLoadCmd;
                }
            } else {
                // Skip case of workspace root path contains whitespace
                if (forFunction) {
                    // for functions on Linux / Cygwin / MinGW
                    return headCopyCmd + replaceHead + functionCondition + ` --nt "use-[wr]p|out-[fr]p|find-ndp"`
                        + ` -t "^(\\s*)msr\\s+-rp\\s+\\S+" `
                        + ` -o "\\1msr -rp ." `
                        + ` -R -c Use relative paths for all find-xxx functions`
                        + tailLoadCmd;
                }
                else {
                    // for single line alias on Linux / Cygwin / MinGW
                    return headCopyCmd + replaceHead + ` --nt "use-[wr]p|out-[fr]p|find-ndp"`
                        + ` -t "^(\\s*alias find-.*?=.*?)msr\\s+-rp\\s+\\S+"`
                        + ` -o "\\1msr -rp ." `
                        + ` -R -c Use relative paths for all find-xxx`
                        + tailLoadCmd;
                }
            }
        }
    }

    function checkSetPathBeforeRunDoskeyAlias(doskeyOrSourceCmd: string, mergeCmd: boolean, setEnvCmd: string = '') {
        if (MsrExe !== 'msr') {
            if (isNullOrEmpty(setEnvCmd)) {
                if (isWindowsTerminal) {
                    setEnvCmd = 'SET "PATH=%PATH%;' + path.dirname(MsrExe) + '"' + (mergeCmd ? ' & ' : '');
                } else {
                    setEnvCmd = 'export PATH=$PATH:' + path.dirname(MsrExe) + (mergeCmd ? '; ' : '');
                }
            }
        }

        if (mergeCmd) {
            runCmdInTerminal(setEnvCmd + doskeyOrSourceCmd, true); //, MsrExe === 'msr');
        } else {
            if (!isNullOrEmpty(setEnvCmd)) {
                runCmdInTerminal(setEnvCmd, true); //, true);
            }

            runCmdInTerminal(doskeyOrSourceCmd, true); //, isNullOrEmpty(setEnvCmd));
        }
    }

    function runCmdInTerminal(cmd: string, showTerminal: boolean = false) {
        const clearAtFirst = MyConfig.ClearTerminalBeforeExecutingCommands;
        if (newTerminal) {
            sendCmdToTerminal(cmd, newTerminal, showTerminal, clearAtFirst, isLinuxOnWindows);
        } else {
            runCommandInTerminal(cmd, showTerminal, clearAtFirst, isLinuxOnWindows);
        }
    }
}

function getCommandAliasMap(
    rootFolderName: string,
    useProjectSpecific: boolean,
    writeToEachFile: boolean,
    dumpOtherCmdAlias: boolean = false,
    newTerminal: vscode.Terminal | undefined = undefined)
    : [Map<string, string>, number, string[]] {

    const rootConfig = getConfig().RootConfig;
    const isWindowsTerminal = IsWindows && (!newTerminal || !/bash/i.test(newTerminal.name));
    const projectKey = useProjectSpecific ? (rootFolderName || '') : 'notUseProject';
    const configText = stringify(rootConfig);
    const configKeyHeads = new Set<string>(configText.split(/=(true|false)?(&|$)/));
    let skipFoldersPattern = getOverrideConfigByPriority([projectKey, 'default'], 'skipFolders') || '^([\\.\\$]|(Release|Debug|objd?|bin|node_modules|static|dist|target|(Js)?Packages|\\w+-packages?)$|__pycache__)';
    if (useProjectSpecific) {
        skipFoldersPattern = mergeSkipFolderPattern(skipFoldersPattern);
    }

    const fileTypes = ['cpp', 'cs', 'py', 'java', 'go', 'php', 'ui', 'scriptFiles', 'configFiles', 'docFiles'];
    const findTypes = ['definition', 'reference'];

    let cmdAliasMap = writeToEachFile && !dumpOtherCmdAlias ? new Map<string, string>() : getExistingCmdAlias(isWindowsTerminal, writeToEachFile);
    const oldCmdCount = cmdAliasMap.size;

    let commands: string[] = [];
    fileTypes.forEach(ext => {
        if (!configKeyHeads.has(ext)) {
            return;
        }

        let cmdName = 'find-' + ext.replace('Files', '');
        const filePattern = getOverrideConfigByPriority([projectKey + '.' + ext, ext, projectKey], 'codeFiles');

        // msr.definition.extraOptions msr.default.extraOptions
        const extraOption = addFullPathHideWarningOption(getOverrideConfigByPriority([projectKey + '.' + ext, ext, projectKey, 'default'], 'extraOptions'));

        let body = 'msr -rp . --nd "' + skipFoldersPattern + '" -f "' + filePattern + '" ' + extraOption;
        commands.push(getCommandAlias(cmdName, body, false));

        findTypes.forEach(fd => {
            // msr.cpp.member.definition msr.py.class.definition msr.default.class.definition msr.default.definition
            let searchPattern = getOverrideConfigByPriority([projectKey + '.' + ext, ext, projectKey, 'default'], fd);
            if (searchPattern.length > 0) {
                searchPattern = ' -t "' + searchPattern + '"';
            }

            // msr.cpp.member.skip.definition  msr.cpp.skip.definition msr.default.skip.definition 
            let skipPattern = getOverrideConfigByPriority([projectKey + '.' + ext, ext, projectKey, 'default'], 'skip.' + fd);
            if (skipPattern.length > 0) {
                skipPattern = ' --nt "' + skipPattern + '"';
            }

            const newBody = body + skipPattern + searchPattern;
            commands.push(getCommandAlias(cmdName + '-' + fd.replace(/^(.{3}).*/, '$1'), newBody, true));
        });
    });

    // find-def find-ref find-all-def find-pure-ref
    [...findTypes, 'all-def', 'pure-ref'].forEach(fd => {
        const findToCmdNameMap = new Map<string, string>()
            .set('pure-ref', 'find-pure-ref')
            .set('all-def', 'find-all-def');
        const findToSearchConfigKeyMap = new Map<string, string>()
            .set('all-def', 'definition')
            .set('pure-ref', 'reference');
        const findToSkipConfigKeyMap = new Map<string, string>()
            .set('all-def', 'definition')
            .set('pure-ref', 'pureReference');

        const configKeyForSkip = findToSkipConfigKeyMap.get(fd) || fd;
        const configKeyForSearch = findToSearchConfigKeyMap.get(fd) || fd;

        const cmdName = findToCmdNameMap.get(fd) || 'find-' + fd.replace(/^(.{3}).*/, '$1');

        // msr.cpp.member.definition msr.py.class.definition msr.default.class.definition msr.default.definition
        let searchPattern = getOverrideConfigByPriority([projectKey, 'default'], configKeyForSearch);

        if (searchPattern.length > 0) {
            searchPattern = ' -t "' + searchPattern + '"';
        }

        // msr.cpp.member.skip.definition  msr.cpp.skip.definition msr.default.skip.definition 
        const configNamesForSkip = fd === 'all-def' ? ['ui', 'default'] : [projectKey, 'default'];
        let skipPattern = getOverrideConfigByPriority(configNamesForSkip, 'skip.' + configKeyForSkip);
        if (skipPattern.length > 0) {
            skipPattern = ' --nt "' + skipPattern + '"';
        }

        const filePattern = getOverrideConfigByPriority([projectKey, 'default'], 'codeFilesPlusUI');

        // msr.definition.extraOptions msr.default.extraOptions
        const extraOption = addFullPathHideWarningOption(getOverrideConfigByPriority([projectKey, 'default'], 'extraOptions'));

        let body = 'msr -rp . --nd "' + skipFoldersPattern + '" -f "' + filePattern + '" ' + extraOption;
        body += skipPattern + searchPattern;
        commands.push(getCommandAlias(cmdName, body, true));
    });

    // msr.cpp.member.definition msr.py.class.definition msr.default.class.definition msr.default.definition
    const additionalFileTypes = ['allFiles', 'docFiles', 'configFiles', 'scriptFiles'];
    additionalFileTypes.forEach(fp => {
        const filePattern = getOverrideConfigByPriority([projectKey, 'default'], fp);

        // find-all
        const cmdName = 'find-' + fp.replace(/[A-Z]\w*$/, '');

        // msr.definition.extraOptions msr.default.extraOptions
        const extraOption = addFullPathHideWarningOption(getOverrideConfigByPriority([projectKey, 'default'], 'extraOptions'));
        let body = 'msr -rp . --nd "' + skipFoldersPattern + '" -f "' + filePattern + '" ' + extraOption;

        commands.push(getCommandAlias(cmdName, body, true));
    });

    // find-nd find-code find-ndp find-small find-all
    const allCodeFilePattern = getOverrideConfigByPriority([projectKey, 'default', ''], 'codeFilesPlusUI');
    const extraOption = addFullPathHideWarningOption(getOverrideConfigByPriority([projectKey, 'default'], 'extraOptions'));
    commands.push(getCommandAlias('find-nd', 'msr -rp . --nd "' + skipFoldersPattern + '" ', false));
    commands.push(getCommandAlias('find-ndp', 'msr -rp %1 --nd "' + skipFoldersPattern + '" ', false));
    commands.push(getCommandAlias('find-code', 'msr -rp . --nd "' + skipFoldersPattern + '" -f "' + allCodeFilePattern + '" ' + extraOption, false));

    const allSmallFilesOptions = getOverrideConfigByPriority([projectKey, 'default', ''], 'allSmallFiles.extraOptions');
    commands.push(getCommandAlias('find-small', 'msr -rp . --nd "' + skipFoldersPattern + '" ' + allSmallFilesOptions, false));

    return [cmdAliasMap, oldCmdCount, commands];
    function getCommandAlias(cmdName: string, body: string, useFunction: boolean): string {
        const text = getCommandAliasText(cmdName, body, useFunction, isWindowsTerminal, writeToEachFile);
        cmdAliasMap.set(cmdName, text);
        return text;
    }
}

function getCommandAliasText(
    cmdName: string,
    cmdBody: string,
    useFunction: boolean,
    isWindowsTerminal: boolean,
    writeToEachFile: boolean,
    addTailArgs: boolean = true,
    hideCmdAddColor: boolean = true): string {
    if (hideCmdAddColor) {
        cmdBody = enableColorAndHideCommandLine(cmdBody);
    }
    // body = replaceTextByRegex(body, /\s+%~?1(\s+|$)/g, '').trimRight();

    const hasSearchTextHolder = isWindowsTerminal ? /%~?1/.test(cmdBody) : /\$1|%~?1/.test(cmdBody);
    if (hasSearchTextHolder) {
        cmdBody = replaceTextByRegex(cmdBody.trimRight(), SearchTextHolderReplaceRegex, '$1');
    }

    const tailArgs = !addTailArgs
        ? ""
        : (hasSearchTextHolder
            ? ' $2 $3 $4 $5 $6 $7 $8 $9'
            : (isWindowsTerminal ? ' $*' : ' $@')
        );

    let commandText = '';
    if (isWindowsTerminal) {
        if (writeToEachFile) {
            commandText = '@' + cmdBody + tailArgs;
            commandText = replaceTextByRegex(commandText, /(\S+)\$1/, '$1%~1');
            commandText = replaceTextByRegex(commandText, /\$(\d+)/, '%$1');
            commandText = replaceText(commandText, '$*', '%*');
        } else {
            commandText = cmdName + '=' + cmdBody + tailArgs;
        }
    } else {
        if (useFunction) {
            const functionName = '_' + replaceText(cmdName, '-', '_');
            if (writeToEachFile) {
                commandText = cmdBody + tailArgs;
            } else {
                commandText = 'alias ' + cmdName + "='function " + functionName + '() {'
                    + '\n\t' + cmdBody + tailArgs
                    + '\n' + '}; ' + functionName + "'";
            }
        } else {
            if (writeToEachFile) {
                commandText = cmdBody + tailArgs;
            } else {
                commandText = 'alias ' + cmdName + "='" + cmdBody + tailArgs + "'";
            }
        }
    }

    return commandText;
}

function outputCmdAliasGuide(singleScriptFolder: string = '') {
    if (singleScriptFolder.length > 0) {
        outputKeyInfo('Add folder ' + singleScriptFolder + ' to PATH then you can directly call the script name everywhere in/out vscode to search/replace like:');
    } else {
        outputKeyInfo('Now you can directly use the command shortcuts in/out-of vscode to search + replace like:');
    }

    outputKeyInfo('find-ndp dir1,dir2,file1,fileN -t MySearchRegex -x AndPlainText');
    outputKeyInfo('find-nd -t MySearchRegex -x AndPlainText');
    outputKeyInfo('find-code -it MySearchRegex -x AndPlainText');
    outputKeyInfo('find-small -it MySearchRegex -U 5 -D 5 : Show up/down lines.');
    outputKeyInfo('find-doc -it MySearchRegex -x AndPlainText -l -PAC : Show pure path list.');
    outputKeyInfo('find-py-def MySearchRegex -x AndPlainText : Search definition in python files.');
    outputKeyInfo('find-py-ref MySearchRegex -x AndPlainText : Search references in python files.');
    outputKeyInfo('find-ref "class\\s+MyClass" -x AndPlainText --np "unit|test" --xp src\\ext,src\\common -c show command line.');
    outputKeyInfo('find-def MyClass -x AndPlainText --np "unit|test" --xp src\\ext,src\\common -c show command line.');
    outputKeyInfo('find-ref MyClass --pp "test|unit" -U 3 -D 3 -H 20 -T 10 :  Preview Up/Down lines + Set Head/Tail lines in test.');
    outputKeyInfo('find-ref MyOldClassMethodName -o NewName -j : Just preview changes only.');
    outputKeyInfo('find-ref MyOldClassMethodName -o NewName -R : Replace files, add -K to backup.');
    outputKeyInfo('alias find-pure-ref');
    outputKeyInfo('malias find -x all -H 9');
    outputKeyInfo('malias "find[\\w-]*ref"');
    outputKeyInfo('malias ".*?(find-\\S+)=.*" -o "\\2"  :  To see all find-xxx alias/doskeys.');
    outputKeyInfo('malias "use-wp|use-rp|out-rp|out-fp" :  To see matched alias/doskeys.');
    outputKeyInfo('use-wp  - Use workspace root paths as input: Root folders of current workspace and extra paths you added.');
    outputKeyInfo('use-rp  - Use relative path as input: The dynamic current folder.');
    outputKeyInfo('out-rp  - Output relative path. This will not effect if use-wp which input full paths of current workspace.');
    outputKeyInfo('out-fp  - Output full path.');
    outputKeyInfo('Add -W to output full path; -I to suppress warnings; -o to replace text, -j to preview changes, -R to replace files.');
    outputKeyInfo('See + Use command alias(shortcut) in `MSR-RUN-CMD` on `TERMINAL` tab, or start using in a new command window outside.');
    outputKeyInfo('(if running `find-xxx` in vscode terminals, you can `click` the search results to open in vscode.)');
}

function addFullPathHideWarningOption(extraOption: string): string {
    if (!/(^|\s+)-[PACIGMOZc]*?W/.test(extraOption)) {
        extraOption = '-W ' + extraOption.trimLeft();
    }

    if (!/(^|\s+)-[PACWGMOZc]*?I/.test(extraOption)) {
        extraOption = '-I ' + extraOption.trimLeft();
    }

    return extraOption.trim();
}

function getExistingCmdAlias(isWindowsTerminal: boolean, forMultipleFiles: boolean): Map<string, string> {
    var map = new Map<string, string>();
    if (!isWindowsTerminal) {
        return map;
    }

    const [output, error] = runCommandGetInfo('cmd /c "doskey /MACROS"', MessageLevel.DEBUG, MessageLevel.DEBUG, MessageLevel.DEBUG);
    if (!output || error) {
        return map;
    }

    return getCmdAliasMapFromText(output, map, forMultipleFiles);
}

function getCmdAliasMapFromText(output: string, map: Map<string, string>, forMultipleFiles: boolean) {
    const lines = output.split(/[\r\n]+/);
    const reg = /^(\w+[\w\.-]+)=(.+)/;
    lines.forEach(a => {
        const match = reg.exec(a);
        if (match) {
            map.set(match[1], forMultipleFiles ? match[2] : match[0]);
        }
    });

    return map;
}

function mergeSkipFolderPattern(skipFoldersPattern: string) {
    if (!isNullOrEmpty(skipFoldersPattern) && MyConfig.ExcludeFoldersFromSettings.size > 0) {
        try {
            const existedExcludeRegex = new RegExp(skipFoldersPattern);
            const extraExcludeFolders = Array.from(MyConfig.ExcludeFoldersFromSettings).filter(a => !existedExcludeRegex.test(a));
            if (extraExcludeFolders.length > 0) {
                if (skipFoldersPattern.indexOf('|node_modules|') > 0) {
                    skipFoldersPattern = skipFoldersPattern.replace('|node_modules|', '|node_modules|' + extraExcludeFolders.join('|') + '|');
                }
                else if (skipFoldersPattern.indexOf('|Debug|') > 0) {
                    skipFoldersPattern = skipFoldersPattern.replace('|Debug|', '|Debug|' + extraExcludeFolders.join('|') + '|');
                }
                else {
                    skipFoldersPattern += '|^(' + extraExcludeFolders.join('|') + ')$';
                }
            }
        }
        catch (error) {
            outputDebug('Failed to add exclude folder from settings:' + error.toString());
        }
    }
    else if (isNullOrEmpty(skipFoldersPattern) && MyConfig.ExcludeFoldersFromSettings.size > 0) {
        skipFoldersPattern = '^(' + Array.from(MyConfig.ExcludeFoldersFromSettings).join('|') + ')$';
    }

    return skipFoldersPattern;
}
