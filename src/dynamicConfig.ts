import path = require('path');
import * as vscode from 'vscode';
import { GetConfigPriorityPrefixes, getConfigValueByAllParts, getConfigValueByProjectAndExtension, getConfigValueOfActiveProject, getConfigValueOfProject } from './configUtils';
import { DefaultRepoFolderName, DefaultWorkspaceFolder, HomeFolder, IsDebugMode, IsLinux, IsWSL, IsWindows, WorkspaceCount, getDefaultRepoFolderByActiveFile, getRepoFolder, getSkipJunkPathArgs, isNullOrEmpty } from './constants';
import { FindType, TerminalType } from './enums';
import { GitIgnore } from './gitUtils';
import { MessageLevel, clearOutputChannelByTimes, outputDebug, outputDebugByTime, outputErrorByTime, outputInfoByDebugModeByTime, outputInfoByTime, outputInfoClearByTime, outputKeyInfoByTime, outputWarnByTime, updateOutputChannel } from './outputUtils';
import { createRegex, escapeRegExp } from './regexUtils';
import { SearchConfig } from './searchConfig';
import { DefaultTerminalType, IsLinuxTerminalOnWindows, IsWindowsTerminalOnWindows, isLinuxTerminalOnWindows, toStoragePaths, toTerminalPath, toTerminalPaths, toTerminalPathsText } from './terminalUtils';
import { getElapsedSecondsToNow, getExtensionNoHeadDot, getRepoFolderName, getRepoFolders, getUniqueStringSetNoCase, nowText, quotePaths, runCommandGetOutput } from './utils';

const SplitPathsRegex = /\s*[,;]\s*/;
const SplitPathGroupsRegex = /\s*;\s*/;
const FolderToPathPairRegex = /(\w+\S+?)\s*=\s*(\S+.+)$/;

let LanguageProcessExistsMap = new Map<string, boolean>();
let LastCheckLanguageProcessTimeMap = new Map<string, Date>();
function needCheckLanguageProcess(mappedExt: string): boolean {
    const lastCheckTime = LastCheckLanguageProcessTimeMap.get(mappedExt);
    if (!lastCheckTime) {
        return true;
    }
    const elapsedMinutes = getElapsedSecondsToNow(lastCheckTime) / 60;
    return elapsedMinutes >= MyConfig.CheckLanguageProcessIntervalMinutes;
}

export const DefaultRepoFolder = getDefaultRepoFolderByActiveFile(true);

export let MyConfig: DynamicConfig;

export let WorkspaceToGitIgnoreMap = new Map<string, GitIgnore>();

export let FileExtensionToMappedExtensionMap = new Map<string, string>();
// 	.set('cxx', 'cpp')
// 	.set('hpp', 'cpp')
// 	.set('scala', 'java')
// 	;

export let MappedExtToCodeFilePatternMap = new Map<string, string>()
    // .set('java', RepoConfig.get('java.codeFiles') as string)
    // .set('ui', RepoConfig.get('ui.codeFiles') as string)
    // .set('cpp', RepoConfig.get('cpp.codeFiles') as string)
    .set('', 'default')
    ;

export let AdditionalFileExtensionMapNames = new Set<string>();

export function getFileNamePattern(parsedFile: path.ParsedPath, useMappedExt: boolean = true): string {
    const extension = getExtensionNoHeadDot(parsedFile.ext);
    if (isNullOrEmpty(parsedFile.ext)) {
        return `^${escapeRegExp(parsedFile.name)}$`
    }

    if (!useMappedExt) {
        return "\\." + extension + "$";
    }

    const mappedExt = FileExtensionToMappedExtensionMap.get(extension) || extension;
    return MappedExtToCodeFilePatternMap.get(mappedExt) || "\\." + extension + "$";
}

export function removeSearchTextForCommandLine(cmd: string): string {
    return cmd.replace(/(\s+-c)\s+Search\s+%~?1/, '$1');
}

export function getGitIgnore(currentPath: string): GitIgnore {
    const repoFolder = getRepoFolder(currentPath);
    const gitIgnore = WorkspaceToGitIgnoreMap.get(repoFolder);
    return gitIgnore || new GitIgnore('');
}

export function addExtensionToPattern(ext: string, fileExtensionsRegex: RegExp) {
    if (fileExtensionsRegex.test('\.' + ext)) {
        return fileExtensionsRegex;
    }

    const firstMatch = /\|(cpp|cs|java|py|go|rs|vue|tsx?|php|bat|cmd|ps1|sh|ini|xml|json|yaml)\|/i.exec(fileExtensionsRegex.source)
        || /\|\w+\|/.exec(fileExtensionsRegex.source);

    const newPattern = firstMatch
        ? fileExtensionsRegex.source.substring(0, firstMatch.index) + '|' + ext.replace('.', '\\.') + fileExtensionsRegex.source.substring(firstMatch.index)
        : fileExtensionsRegex.source + '|\\.' + ext + '$';

    try {
        fileExtensionsRegex = new RegExp(newPattern, 'i');
    } catch (err) {
        outputErrorByTime('Failed to add extension: "' + ext + '" to AllFilesRegex, error: ' + err);
    }

    return fileExtensionsRegex;
}

class DynamicConfig {
    public RepoConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('msr');

    // Temp toggle enable/disable finding definition and reference
    public IsEnabledFindingDefinition: boolean = true;

    public ClearTerminalBeforeExecutingCommands: boolean = false;
    public ShowInfo: boolean = false;
    public IsQuiet: boolean = false;
    public IsDebug: boolean = false;
    public DescendingSortForConsoleOutput: boolean = false;
    public DescendingSortForVSCode: boolean = false;

    public MaxSearchDepth: number = 16;
    public NeedSortResults: boolean = false;

    public ReRunCmdInTerminalIfCostLessThan: number = 3.3;
    public ReRunSearchInTerminalIfResultsMoreThan: number = 1;
    public DisableReRunSearch: boolean = true;
    public OnlyFindDefinitionForKnownLanguages: boolean = true;

    public GetSearchTextHolderInCommandLine: RegExp = /\s+-c\s+.*?%~?1/;
    public DisabledFileExtensionRegex: RegExp = new RegExp('to-load');
    public DisabledRepoFolderNameRegex: RegExp = new RegExp('to-load');
    public DisableFindDefinitionFileExtensionRegex: RegExp = new RegExp('to-load');
    public DisableFindReferenceFileExtensionRegex: RegExp = new RegExp('to-load');

    public ExcludeFoldersFromSettings: Set<string> = new Set<string>();

    public InitProjectCmdAliasForNewTerminals: boolean = true;
    public SkipInitCmdAliasForNewTerminalTitleRegex: RegExp = new RegExp('to-load');
    public OverwriteProjectCmdAliasForNewTerminals: boolean = true;
    public AutoMergeSkipFolders: boolean = true;

    public HideWarningsAndExtraInfoWhenCookingCommandAlias: boolean = false;
    public OutputFullPathWhenCookingCommandAlias: boolean = false;
    public OutputFullPathWhenCookAndDumpingAliasFiles: boolean = true;
    public OutputRelativePathForLinuxTerminalsOnWindows: boolean = true;
    public AddEchoOffWhenCookingWindowsCommandAlias: string = '';
    public SetVariablesToLocalScopeWhenCookingWindowsCommandAlias: string = '';
    public DefaultConstantsRegex: RegExp = new RegExp('to-load');
    public UseDefaultFindingClassCheckExtensionRegex: RegExp = new RegExp('to-load');
    public MaxWaitSecondsForSearchDefinition: number = 36.0;
    public MaxWaitSecondsForAutoReSearchDefinition: number = 60.0;

    public UseGitIgnoreFile: boolean = true;
    public OmitGitIgnoreExemptions: boolean = false;
    public IgnoreDotFolderNamePattern: string = '';

    // allFiles codeFiles codeFilesPlusUI codeAndConfig codeAndConfigDocs
    public AllFileExtensionMappingRegexList: RegExp[] = [];
    public CodeFileExtensionMappingTypesRegex: RegExp = new RegExp('to-load msr.codeFileExtensionMappingTypes');
    public AllFilesRegex: RegExp = new RegExp('to-load msr.default.allFiles');
    public AllFilesDefaultRegex: RegExp = new RegExp('to-load msr.default.allFiles');
    public CodeFilesRegex: RegExp = new RegExp('to-load msr.default.codeFiles');
    public CodeFilesDefaultRegex: RegExp = new RegExp('to-load msr.default.codeFiles');
    public CodeFilesPlusUIRegex: RegExp = new RegExp('to-load msr.default.codeFilesPlusUI');
    public CodeFilesPlusUIDefaultRegex: RegExp = new RegExp('to-load msr.default.codeFilesPlusUI');
    public CodeAndConfigRegex: RegExp = new RegExp('to-load msr.default.codeAndConfig');
    public CodeAndConfigDefaultRegex: RegExp = new RegExp('to-load msr.default.codeAndConfig');
    public CodeAndConfigDocsRegex: RegExp = new RegExp('to-load msr.default.codeAndConfigDocs');
    public CodeAndConfigDocsDefaultRegex: RegExp = new RegExp('to-load msr.default.codeAndConfigDocs');

    public ScriptFileExtensionRegex: RegExp = new RegExp('to-load msr.default.scriptFiles');
    public ConfigAndDocFilesRegex: RegExp = new RegExp('to-load msr.default.configAndDocs');
    public AutoChangeSearchWordForReference: boolean = true;
    public RefreshTmpGitFileListDuration: string = '10m';
    public AutoUpdateSearchTool: boolean = false;
    public CheckLanguageProcessIntervalMinutes = 15;
    public OverwriteInconsistentCommonAliasByExtension = true;
    public AutoRestoreEnvAliasTerminalNameRegex: RegExp = new RegExp('to-load');
    public ReplaceTabTo = ' '.repeat(4);

    private UseGitFileListToSearchSingleWorkspace: string = 'auto';
    private TmpToggleEnabledExtensionToValueMap = new Map<string, boolean>();
    private ProjectToGitIgnoreStatusMap = new Map<String, boolean>();
    private ChangePowerShellTerminalToCmdOrBashConfig: string = "auto";


    public getCmdAliasScriptFolder(): string {
        const folder = this.RepoConfig.get('cmdAlias.saveFolder') as string;
        return isNullOrEmpty(folder) ? HomeFolder : folder.trim();
    }

    public isKnownLanguage(extension: string): boolean {
        return FileExtensionToMappedExtensionMap.has(extension) || this.RepoConfig.get(extension) !== undefined;
    }

    public isUnknownFileType(extension: string): boolean {
        const ext = extension.replace(/.*?\.(\w+)$/, '$1');
        if (this.isKnownLanguage(ext)) {
            return false;
        }

        if (this.AllFilesRegex.test(extension) || this.AllFilesDefaultRegex.test(extension)) {
            return false;
        }

        for (let reg of this.AllFileExtensionMappingRegexList) {
            if (extension.match(reg)) {
                return false;
            }
        }

        return true;
    }

    public toggleEnableFindingDefinition(currentFilePath: string) {
        const filePath = path.parse(currentFilePath);
        const extension = getExtensionNoHeadDot(filePath.ext);
        const isKnownType = this.isKnownLanguage(extension);
        const mappedExt = FileExtensionToMappedExtensionMap.get(extension) || extension;
        const currentStatus = this.TmpToggleEnabledExtensionToValueMap.get(mappedExt);

        let isEnabled = currentStatus === true;
        const checkProcessPattern = this.getCheckingLanguageProcessPattern(currentFilePath, extension, mappedExt);
        const isAutoDisable = !isNullOrEmpty(checkProcessPattern);
        if (undefined === currentStatus) {
            if (isKnownType) {
                isEnabled = !this.DisabledFileExtensionRegex.test(extension) && !this.DisableFindDefinitionFileExtensionRegex.test(extension) && !isAutoDisable;
            } else {
                isEnabled = !MyConfig.OnlyFindDefinitionForKnownLanguages && !isAutoDisable;
            }
        }

        const hasFoundLanguageProcess = LanguageProcessExistsMap.get(mappedExt);
        this.TmpToggleEnabledExtensionToValueMap.set(mappedExt, !isEnabled);
        outputKeyInfoByTime(`Status = '${(isEnabled ? 'disabled' : 'enabled')}' for finding ${mappedExt} definition. HasFoundLanguageProcess = ${hasFoundLanguageProcess}.`);
    }

    public useGitFileList(treatAutoAsTrueForInit: boolean = true): boolean {
        if (WorkspaceCount !== 1) {
            return false;
        }

        const gitIgnore = getGitIgnore(DefaultWorkspaceFolder);
        switch (this.UseGitFileListToSearchSingleWorkspace) {
            case 'false':
                return false;
            case 'true':
                return true;
            case 'auto':
                if (!gitIgnore.Valid) {
                    return gitIgnore.Completed ? false : treatAutoAsTrueForInit;
                }
                return gitIgnore.ExemptionCount > 0;
            default:
                outputErrorByTime(`Invalid value for 'msr.useGitFileListToSearchSingleWorkspace' = '${this.UseGitFileListToSearchSingleWorkspace}'.`);
                return false;
        }
    }

    public update() {
        this.RepoConfig = vscode.workspace.getConfiguration('msr');
        const repoFolderName = DefaultRepoFolderName;
        this.ConfigAndDocFilesRegex = new RegExp(getConfigValueOfProject(repoFolderName, 'configAndDocs') || '\\.(json|xml|ini|ya?ml|md)|readme', 'i');

        const codeFileExtensionMappingTypes = getConfigValueOfProject(repoFolderName, 'codeFileExtensionMappingTypes') || '^(cpp|cs|java|py|go|rs|ui)$';
        this.CodeFileExtensionMappingTypesRegex = new RegExp(codeFileExtensionMappingTypes.trim(), 'i');

        this.AllFilesRegex = new RegExp(getConfigValueOfProject(repoFolderName, 'allFiles') || '\.(cp*|hp*|cs|java|scala|py|go|tsx?)$', 'i');
        this.AllFilesDefaultRegex = new RegExp(getConfigValueOfProject('', 'allFiles') || '\.(cp*|hp*|cs|java|scala|py|go|tsx?)$', 'i');
        this.CodeFilesRegex = new RegExp(getConfigValueOfProject(repoFolderName, 'codeFiles') || '\.(cp*|hp*|cs|java|scala|py|go)$', 'i');
        this.CodeFilesDefaultRegex = new RegExp(getConfigValueOfProject('', 'codeFiles') || '\.(cp*|hp*|cs|java|scala|py|go)$', 'i');
        this.CodeAndConfigRegex = new RegExp(getConfigValueOfProject(repoFolderName, 'codeAndConfig') || '\.(cp*|hp*|cs|java|scala|py|go|md)$', 'i');
        this.CodeAndConfigDefaultRegex = new RegExp(getConfigValueOfProject('', 'codeAndConfig') || '\.(cp*|hp*|cs|java|scala|py|go|md)$', 'i');
        this.CodeFilesPlusUIRegex = new RegExp(getConfigValueOfProject(repoFolderName, 'codeFilesPlusUI') || '\.(cp*|hp*|cs|java|scala|py|go|tsx?)$', 'i');
        this.CodeFilesPlusUIDefaultRegex = new RegExp(getConfigValueOfProject('', 'codeFilesPlusUI') || '\.(cp*|hp*|cs|java|scala|py|go|tsx?)$', 'i');
        this.CodeAndConfigDocsRegex = new RegExp(getConfigValueOfProject(repoFolderName, 'codeAndConfigDocs') || '\\.(cs\\w*|nuspec|config|c[px]*|h[px]*|java|scala|py|go|php|vue|tsx?|jsx?|json|ya?ml|xml|ini|md)$|readme', 'i');
        this.CodeAndConfigDocsDefaultRegex = new RegExp(getConfigValueOfProject('', 'codeAndConfigDocs') || '\\.(cs\\w*|nuspec|config|c[px]*|h[px]*|java|scala|py|go|php|vue|tsx?|jsx?|json|ya?ml|xml|ini|md)$|readme', 'i');
        this.UseGitFileListToSearchSingleWorkspace = (getConfigValueOfProject(repoFolderName, 'useGitFileListToSearchSingleWorkspace') || '').toLowerCase();
        this.AutoRestoreEnvAliasTerminalNameRegex = createRegex(getConfigValueOfProject(repoFolderName, 'autoRestoreEnvAliasTerminalNameRegex'), 'i');
        const replaceTabToText = vscode.workspace.getConfiguration('msr').get('replaceMultiLineAliasBodyTabTo') as string || '4 spaces';
        this.ReplaceTabTo = /(\d+)\s*space/i.test(replaceTabToText) ? ' '.repeat(parseInt(replaceTabToText.replace(/\D+/g, ''))) : '\t';

        this.AllFileExtensionMappingRegexList = [];
        const fileExtensionMapInConfig = this.RepoConfig.get('fileExtensionMap') as {};
        if (fileExtensionMapInConfig) {
            Object.keys(fileExtensionMapInConfig).forEach((mapExt) => {
                const extensions = (this.RepoConfig.get('fileExtensionMap.' + mapExt) as string).split(/\s+/);
                // exempt \w* case // const regexExtensions = extensions.map(ext => escapeRegExp(ext));
                const regexExtensions = extensions.map(ext => ext.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/"/g, '\\"'));
                const extensionsRegex = new RegExp('\\.(' + regexExtensions.join('|') + ')$', 'i');
                this.AllFileExtensionMappingRegexList.push(extensionsRegex);
                MappedExtToCodeFilePatternMap.set(mapExt, extensionsRegex.source);
                extensions.forEach((ext) => {
                    FileExtensionToMappedExtensionMap.set(ext, mapExt);
                    this.AllFilesRegex = addExtensionToPattern(ext, this.AllFilesRegex);
                    this.AllFilesDefaultRegex = addExtensionToPattern(ext, this.AllFilesDefaultRegex);
                    if (this.CodeFileExtensionMappingTypesRegex.test(mapExt)) {
                        this.CodeFilesRegex = addExtensionToPattern(ext, this.CodeFilesRegex);
                        this.CodeFilesDefaultRegex = addExtensionToPattern(ext, this.CodeFilesDefaultRegex);
                        this.CodeAndConfigRegex = addExtensionToPattern(ext, this.CodeAndConfigRegex);
                        this.CodeAndConfigDefaultRegex = addExtensionToPattern(ext, this.CodeAndConfigDefaultRegex);
                        this.CodeFilesPlusUIRegex = addExtensionToPattern(ext, this.CodeFilesPlusUIRegex);
                        this.CodeFilesPlusUIDefaultRegex = addExtensionToPattern(ext, this.CodeFilesPlusUIDefaultRegex);
                        this.CodeAndConfigDocsRegex = addExtensionToPattern(ext, this.CodeAndConfigDocsRegex);
                        this.CodeAndConfigDocsDefaultRegex = addExtensionToPattern(ext, this.CodeAndConfigDocsDefaultRegex);
                    }
                });
            });
        }

        const fileExtensionMapNames = getConfigValueOfProject(repoFolderName, "fileExtensionMapNames") as string || '';
        const extensionNameSet = new Set<string>(fileExtensionMapNames.split(/\s+/));
        AdditionalFileExtensionMapNames.clear();
        extensionNameSet.forEach(ext => {
            const mappedExtValues = MappedExtToCodeFilePatternMap.get(ext) || '';
            if (!isNullOrEmpty(mappedExtValues) && mappedExtValues !== ext) {
                outputWarnByTime(`Skipped extension = '${ext}' from 'msr.fileExtensionMapNames', use existing ext-mapping: '${mappedExtValues}' from 'msr.fileExtensionMap.${ext}'.`);
                return;
            }
            AdditionalFileExtensionMapNames.add(ext);
            outputInfoByDebugModeByTime(`Added extension = '${ext}' from 'msr.fileExtensionMapNames', will create alias like 'find-${ext}' + 'find-${ext}-ref' for it.`);
        });

        this.OnlyFindDefinitionForKnownLanguages = getConfigValueOfActiveProject('enable.onlyFindDefinitionForKnownLanguages') === 'true';
        this.ClearTerminalBeforeExecutingCommands = getConfigValueOfActiveProject('clearTerminalBeforeExecutingCommands') === 'true';
        this.InitProjectCmdAliasForNewTerminals = getConfigValueOfActiveProject('initProjectCmdAliasForNewTerminals') === 'true';
        this.ChangePowerShellTerminalToCmdOrBashConfig = getConfigValueOfActiveProject('changePowerShellTerminalToCmdOrBash');
        this.SkipInitCmdAliasForNewTerminalTitleRegex = createRegex(getConfigValueOfActiveProject('skipInitCmdAliasForNewTerminalTitleRegex'), 'i');
        this.OverwriteProjectCmdAliasForNewTerminals = getConfigValueOfActiveProject('overwriteProjectCmdAliasForNewTerminals') === 'true';
        this.AutoMergeSkipFolders = getConfigValueOfActiveProject('autoMergeSkipFolders') === 'true';
        this.ShowInfo = getConfigValueOfActiveProject('showInfo') === 'true';
        this.IsQuiet = getConfigValueOfActiveProject('quiet') === 'true';
        this.IsDebug = getConfigValueOfActiveProject('debug') === 'true';
        updateOutputChannel(IsDebugMode ? MessageLevel.DEBUG : MessageLevel.INFO, this.IsQuiet);
        this.DescendingSortForConsoleOutput = getConfigValueOfActiveProject('descendingSortForConsoleOutput') === 'true';
        this.DescendingSortForVSCode = getConfigValueOfActiveProject('descendingSortForVSCode') === 'true';
        this.MaxSearchDepth = parseInt(getConfigValueOfActiveProject('maxSearchDepth') || '0');
        this.NeedSortResults = getConfigValueOfActiveProject('sortResults') === 'true';
        this.ReRunCmdInTerminalIfCostLessThan = Number(getConfigValueOfActiveProject('reRunSearchInTerminalIfCostLessThan') || '3.3');
        this.ReRunSearchInTerminalIfResultsMoreThan = Number(getConfigValueOfActiveProject('reRunSearchInTerminalIfResultsMoreThan') || '1');
        this.DisableReRunSearch = getConfigValueOfActiveProject("disableReRunSearch") === 'true';
        this.DefaultConstantsRegex = new RegExp(getConfigValueOfActiveProject('isFindConstant'));

        this.DisabledRepoFolderNameRegex = createRegex(getConfigValueOfActiveProject('disable.projectRepoFolderNamePattern'));

        this.DisabledFileExtensionRegex = createRegex(getConfigValueOfActiveProject('disable.extensionPattern'), 'i', true);
        this.DisableFindDefinitionFileExtensionRegex = createRegex(getConfigValueOfActiveProject('disable.findDef.extensionPattern'), 'i', true);
        this.DisableFindReferenceFileExtensionRegex = createRegex(getConfigValueOfActiveProject('disable.findRef.extensionPattern'), 'i', true);

        this.HideWarningsAndExtraInfoWhenCookingCommandAlias = getConfigValueOfActiveProject('cookCmdAlias.hideWarningsAndExtraInfo') === 'true';
        this.OutputFullPathWhenCookingCommandAlias = getConfigValueOfActiveProject('cookCmdAlias.outputFullPath') === 'true';
        this.OutputFullPathWhenCookAndDumpingAliasFiles = getConfigValueOfActiveProject('cookCmdAlias.outputFullPathForDumpingScriptFiles') === 'true';
        this.OutputRelativePathForLinuxTerminalsOnWindows = getConfigValueOfActiveProject('cookCmdAlias.outputRelativePathForLinuxTerminalsOnWindows') === 'true';
        this.AddEchoOffWhenCookingWindowsCommandAlias = getConfigValueOfActiveProject('cookCmdAlias.addEchoOff', true);
        this.SetVariablesToLocalScopeWhenCookingWindowsCommandAlias = getConfigValueOfActiveProject('cookCmdAlias.setVariablesToLocalScope', true);

        this.UseDefaultFindingClassCheckExtensionRegex = createRegex(getConfigValueOfActiveProject('useDefaultFindingClass.extensions'));

        this.MaxWaitSecondsForSearchDefinition = Number(getConfigValueOfActiveProject('searchDefinition.timeoutSeconds'));
        this.MaxWaitSecondsForAutoReSearchDefinition = Number(getConfigValueOfActiveProject('autoRunSearchDefinition.timeoutSeconds'));
        this.ScriptFileExtensionRegex = createRegex(this.RepoConfig.get('default.scriptFiles') || '\\.(bat|cmd|psm?1|sh|bash|[kzct]sh)$', 'i');
        this.UseGitIgnoreFile = getConfigValueOfActiveProject('useGitIgnoreFile') === 'true';
        this.OmitGitIgnoreExemptions = getConfigValueOfActiveProject('omitGitIgnoreExemptions') === 'true';
        this.IgnoreDotFolderNamePattern = getConfigValueOfActiveProject('ignorableDotFolderNameRegex') || '';
        this.AutoChangeSearchWordForReference = getConfigValueOfActiveProject('reference.autoChangeSearchWord') === 'true';
        this.RefreshTmpGitFileListDuration = (getConfigValueOfActiveProject('refreshTmpGitFileListDuration', true) || '10m').replace(/\s+/g, '');
        this.AutoUpdateSearchTool = getConfigValueOfActiveProject('autoUpdateSearchTool') === 'true';
        this.CheckLanguageProcessIntervalMinutes = Math.max(5, Number(getConfigValueOfActiveProject('checkLanguageProcessIntervalMinutes') || '20'));
        this.OverwriteInconsistentCommonAliasByExtension = getConfigValueOfActiveProject('overwriteInconsistentCommonAliasByExtension') !== 'false';
        SearchConfig.reload();

        this.ExcludeFoldersFromSettings.clear();
        if (this.AutoMergeSkipFolders) {
            this.ExcludeFoldersFromSettings = this.getExcludeFolders('search');
            this.getExcludeFolders('files').forEach(a => this.ExcludeFoldersFromSettings.add(a));
        }
    }

    // If has git-exemptions, should not use git-ignore and thus better to use PowerShell (general search).
    public setGitIgnoreStatus(repoFolder: string, isGood: boolean) {
        MyConfig.ProjectToGitIgnoreStatusMap.set(repoFolder, isGood);
    }

    public canUseGoodGitIgnore(repoFolder: string) {
        if (/false/i.test(MyConfig.ChangePowerShellTerminalToCmdOrBashConfig)) {
            return false;
        }

        if (MyConfig.ProjectToGitIgnoreStatusMap.get(repoFolder)) {
            return true;
        }

        return false;
    }

    public isScriptFile(extension: string): boolean {
        return this.ScriptFileExtensionRegex.test(extension.startsWith('.') ? extension : '.' + extension);
    }

    public isCodeFiles(extension: string): boolean {
        return this.CodeFilesRegex.test(extension.startsWith('.') ? extension : '.' + extension) && !this.isScriptFile(extension);
    }

    public shouldSkipFinding(findType: FindType, currentFilePath: string): boolean {
        const parsedFile = path.parse(currentFilePath);
        const extension = getExtensionNoHeadDot(parsedFile.ext);
        const mappedExt = FileExtensionToMappedExtensionMap.get(extension) || extension;

        const findTypeText = "finding '" + FindType[findType] + "' in '" + mappedExt + "' files";
        const toggleTip = FindType.Reference === findType ? '' : 'Change it or temporarily toggle `enable/disable`.';
        const toggleStatus = this.TmpToggleEnabledExtensionToValueMap.get(mappedExt);

        // Skip finding definition if toggled to disabled:
        if (toggleStatus !== undefined && FindType.Reference !== findType) {
            const status = true === toggleStatus ? 'enabled' : 'disabled';
            outputInfoClearByTime(`Status = '${status}' for ${findTypeText} as menu or hot key of 'msr.tmpToggleEnableFindingDefinition' had been triggered,`
                + ` or 'msr.${mappedExt}.autoDisableFindDefinitionPattern' is not empty. HasFoundLanguageProcess = ${LanguageProcessExistsMap.get(mappedExt)}.`);
            return false === toggleStatus;
        }

        if (this.OnlyFindDefinitionForKnownLanguages) {
            if (isNullOrEmpty(mappedExt) || !this.isKnownLanguage(extension)) {
                outputInfoClearByTime(`Disabled ${findTypeText} files due to 'msr.enable.onlyFindDefinitionForKnownLanguages' = true + Not exist 'msr.fileExtensionMap.${extension}' nor 'msr.${extension}.extension.xxx'. ${toggleTip}`.trim());
                return true;
            }
        }

        const checkRegex = FindType.Definition === findType
            ? this.DisableFindDefinitionFileExtensionRegex
            : this.DisableFindReferenceFileExtensionRegex;

        if (MyConfig.DisabledFileExtensionRegex.test(extension)) {
            outputInfoClearByTime("Disabled " + findTypeText + " by 'msr.disable.extensionPattern' = '" + this.DisabledFileExtensionRegex.source + "'. " + toggleTip);
            return true;
        }

        if (checkRegex.test(extension)) {
            const configName = FindType.Definition === findType ? 'disable.findDef.extensionPattern' : 'disable.findRef.extensionPattern';
            outputInfoClearByTime(`Disabled ${findTypeText} by '${configName}' = '${this.RepoConfig.get(configName)}'. ${toggleTip}`.trim());
            return true;
        }

        const repoFolderName = getRepoFolderName(currentFilePath, true);
        if (MyConfig.DisabledRepoFolderNameRegex.test(repoFolderName)) {
            outputInfoClearByTime(`Disabled ${findTypeText} by 'msr.disable.projectRepoFolderNamePattern' = '${MyConfig.DisabledRepoFolderNameRegex.source}'. ${toggleTip}`.trim());
            return true;
        }

        // Skip finding definition if set to disabled when found language extensions running:
        if (this.shouldSkipFindingDefinitionByLanguageProcess(currentFilePath, extension, mappedExt)) {
            return true;
        }

        return false;
    }

    private getCheckingLanguageProcessPattern(currentFilePath: string, extension: string, mappedExt: string): string {
        const repoFolderName = getRepoFolderName(currentFilePath, true);
        return getConfigValueByProjectAndExtension(repoFolderName, extension, mappedExt, 'autoDisableFindDefinitionPattern', true)
            .replace(/#_MappedExtName_#/g, mappedExt)
            .trim();
    }

    private shouldSkipFindingDefinitionByLanguageProcess(currentFilePath: string, extension: string, mappedExt: string): boolean {
        const checkProcessPattern = this.getCheckingLanguageProcessPattern(currentFilePath, extension, mappedExt);
        if (isNullOrEmpty(checkProcessPattern)) {
            return false;
        }

        if (!needCheckLanguageProcess(mappedExt)) {
            const lastCheckTime = LastCheckLanguageProcessTimeMap.get(mappedExt) || new Date();
            clearOutputChannelByTimes();
            if (LanguageProcessExistsMap.get(mappedExt)) {
                outputInfoByTime(`Skip finding definition for '${mappedExt}' since found language process. Last check time = ${lastCheckTime.toISOString()}. Current 'msr.${mappedExt}.autoDisableFindDefinitionPattern' = "${checkProcessPattern}"`);
                return true;
            }
        }

        try {
            clearOutputChannelByTimes();
            new RegExp(checkProcessPattern); // to catch Regex error.
            const repoFolderName = getRepoFolderName(currentFilePath, true);
            const languageProcessName = getConfigValueByProjectAndExtension(repoFolderName, extension, mappedExt, 'languageProcessName')
                .replace(/\.exe$/i, '');
            const fastFilter = isNullOrEmpty(languageProcessName) ? '' : `where "Name = '${languageProcessName}.exe'"`;
            const checkCommand = IsWindows
                // ? `PowerShell - Command "Get-Process ${fastFilter} | Where-Object { $_.Path -imatch '${checkProcessPattern}'} | Select-Object -Property Id, ProcessName, Path"`
                ? `wmic process ${fastFilter} get ProcessId, CommandLine | msr -it "${checkProcessPattern}" --nt "msr\\s+-it" -PAC`
                : `ps -ef | grep -iE '${checkProcessPattern}' | grep -v grep`
                ;
            const output = runCommandGetOutput(checkCommand, IsWindows).trim().replace(/\s+(\d+)[ \t]*/g, ' $1')
                .replace(/([\r\n])+/g, '$1')
                .replace(/^(.+?)\s+(\d+)$/gm, 'PID = $2 , Command = $1');
            const hasFoundLanguageProcess = !isNullOrEmpty(output);
            LanguageProcessExistsMap.set(mappedExt, hasFoundLanguageProcess);
            LastCheckLanguageProcessTimeMap.set(mappedExt, new Date());
            if (hasFoundLanguageProcess) {
                outputInfoByTime(`Skip finding definition for ${mappedExt} as found language process by 'msr.${mappedExt}.autoDisableFindDefinitionPattern' = "${checkProcessPattern}" as below:\n${output}`);
                return true;
            }
        } catch (err) {
            outputErrorByTime(`Failed to check/disable finding definition for ${mappedExt}: Regex = "${checkProcessPattern}", Error = ${String(err)}`);
            console.log(err);
        }

        return false;
    }

    private getExcludeFolders(keyName: string): Set<string> {
        let textSet = new Set<string>();
        let config = vscode.workspace.getConfiguration(keyName);
        if (!config || !config.exclude) {
            return textSet;
        }

        const trimRegex = /^[\s\*/]+|[\s\*/]+$/g;
        try {
            let map = new Map(Object.entries(config.exclude));
            map.forEach((value, key, _m) => {
                if (value) {
                    let text = key.replace(trimRegex, '');
                    if (/^[\w-]+$/.test(text)) {
                        textSet.add(text);
                    }
                }
            });
        } catch (error) {
            outputDebugByTime('Failed to get exclude folder from `' + keyName + '.exclude`: ' + error);
        }

        outputDebugByTime('Got ' + textSet.size + ' folders of `' + keyName + '.exclude`: ' + Array.from(textSet).join(' , '));
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
    outputDebug('----- vscode-msr configuration loaded: ' + nowText() + ' -----');
    printConfigInfo(MyConfig.RepoConfig);

    return MyConfig;
}

export function replaceToRelativeSearchPath(toRunInTerminal: boolean, searchPaths: string, repoFolder: string) {
    if (!SearchConfig.shouldUseRelativeSearchPath(toRunInTerminal)
        || isNullOrEmpty(searchPaths) || isNullOrEmpty(repoFolder)
        || WorkspaceCount > 1
        // || searchPaths.includes(',')
    ) {
        return searchPaths;
    }

    const paths = searchPaths.split(',').map(a => {
        if (a === repoFolder) {
            return ".";
        }
        return IsWindows ? a.replace(repoFolder + '\\', ".\\") : a.replace(repoFolder + "/", "./");
    });

    searchPaths = paths.join(',');
    return searchPaths;
}

function getJunkFolderForProject(projectGitFolder: string, extension: string, mappedExt: string, subName = 'reference'): string {
    const folderName = getRepoFolderName(projectGitFolder, true);
    let skipFoldersPattern = getConfigValueByAllParts(folderName, extension, mappedExt, subName, 'skipFolders');
    return mergeSkipFolderPattern(skipFoldersPattern);
}

function getSkipFolderCommandOption(repoFolder: string, isForProjectCmdAlias: boolean, useSkipFolders: boolean, toRunInTerminal: boolean, repoFolderCount: number, extension: string, mappedExt: string, subName: string): string {
    if (toRunInTerminal) {
        return repoFolderCount < 2
            ? getSkipJunkPathArgs(IsWindowsTerminalOnWindows) :
            ` --nd "${getJunkFolderForProject('', extension, mappedExt, subName)}"`;
    }
    const gitIgnoreInfo = getGitIgnore(repoFolder);
    const skipFoldersPattern = getJunkFolderForProject(isForProjectCmdAlias ? repoFolder : '', extension, mappedExt, subName);
    const skipFolderOptions = isForProjectCmdAlias && gitIgnoreInfo.Valid && (!toRunInTerminal || repoFolderCount < 2)
        ? ` --np "${gitIgnoreInfo.getSkipPathRegexPattern(toRunInTerminal)}"`
        : (useSkipFolders && skipFoldersPattern.length > 1 ? ` --nd "${skipFoldersPattern}"` : '');
    return skipFolderOptions;
}

export function getSearchPathOptions(
    toRunInTerminal: boolean,
    isForProjectCmdAlias: boolean,
    codeFilePath: string,
    mappedExt: string,
    isFindingDefinition: boolean,
    useExtraSearchPathsForReference: boolean = false,
    useExtraSearchPathsForDefinition: boolean = true,
    useSkipFolders: boolean = true,
    usePathListFiles: boolean = true,
    forceSetSearchPath: string = '',
    isRecursive: boolean = true): string {
    const allRepoFolders = getRepoFolders(codeFilePath);
    const repoFolder = allRepoFolders.includes(forceSetSearchPath) ? getRepoFolder(forceSetSearchPath) : getRepoFolder(codeFilePath);
    const extension = getExtensionNoHeadDot(path.parse(codeFilePath).ext, '');
    const repoFolderName = getRepoFolderName(codeFilePath, true);
    const findDefinitionInAllFolders = getConfigValueByProjectAndExtension(repoFolderName, extension, mappedExt, 'definition.searchAllRepoFolders') === "true";
    const findReferencesInAllRepoFolders = getConfigValueByProjectAndExtension(repoFolderName, extension, mappedExt, 'reference.searchAllRepoFolders') === "true";
    const findAllFolders = isFindingDefinition ? findDefinitionInAllFolders : findReferencesInAllRepoFolders;
    const rootPaths = !isNullOrEmpty(forceSetSearchPath)
        ? forceSetSearchPath
        : (findAllFolders ? getRepoFolders(codeFilePath).join(',') : getRepoFolder(codeFilePath));

    const recursiveOption = isRecursive || isNullOrEmpty(rootPaths) ? '-rp ' : '-p ';
    const folderKey = isForProjectCmdAlias ? repoFolderName : '';

    const subName = isFindingDefinition ? 'definition' : 'reference';
    const terminalType = !toRunInTerminal && isLinuxTerminalOnWindows() ? TerminalType.CMD : DefaultTerminalType;
    const skipFolderOptions = getSkipFolderCommandOption(repoFolder, isForProjectCmdAlias, useSkipFolders, toRunInTerminal, allRepoFolders.length, extension, mappedExt, subName);

    const shouldSearchExtraPaths = isFindingDefinition && useExtraSearchPathsForDefinition || !isFindingDefinition && useExtraSearchPathsForReference;
    if (!shouldSearchExtraPaths) {
        if (isNullOrEmpty(rootPaths)) { // files not in project
            const searchPaths = quotePaths(isFindingDefinition ? toTerminalPath(replaceToRelativeSearchPath(toRunInTerminal, path.dirname(codeFilePath), repoFolder), terminalType) : codeFilePath);
            return '-p ' + searchPaths;
        } else {
            const searchPaths = quotePaths(toTerminalPathsText(replaceToRelativeSearchPath(toRunInTerminal, rootPaths, repoFolder), terminalType));
            return recursiveOption + searchPaths + ' ' + skipFolderOptions;
        }
    }

    const [extraSearchPathSet, extraSearchPathFileListSet] = shouldSearchExtraPaths
        ? getExtraSearchPaths(folderKey, extension, mappedExt)
        : [new Set<string>(), new Set<string>()];

    let searchPathSet = new Set<string>((rootPaths || (isFindingDefinition ? path.dirname(codeFilePath) : codeFilePath)).split(','));
    extraSearchPathSet.forEach(a => searchPathSet.add(a));
    searchPathSet = toTerminalPaths(getUniqueStringSetNoCase(searchPathSet), terminalType);

    let pathsText = Array.from(searchPathSet).join(',').replace(/"/g, '');
    pathsText = quotePaths(pathsText);
    if (isNullOrEmpty(pathsText)) {
        pathsText = '.';
    }

    const pathListFileSet = toTerminalPaths(getUniqueStringSetNoCase(extraSearchPathFileListSet), terminalType);
    let pathFilesText = Array.from(pathListFileSet).join(',').replace(/"/g, '');
    pathFilesText = quotePaths(pathFilesText);

    const readPathListOptions = usePathListFiles && pathListFileSet.size > 0 ? ' -w "' + pathFilesText + '"' : '';
    const searchPaths = replaceToRelativeSearchPath(toRunInTerminal, pathsText, repoFolder);
    const otherOptions = isNullOrEmpty(rootPaths) ? '' : readPathListOptions + ' ' + skipFolderOptions;
    return recursiveOption + quotePaths(searchPaths) + otherOptions;
}

export function getExtraSearchPaths(folderKey: string, extension: string, mappedExt: string): [Set<string>, Set<string>] {
    let extraSearchPathSet = getExtraSearchPathsOrFileLists('extraSearchPaths', folderKey, extension, mappedExt);
    getExtraSearchPathsOrFileLists('extraSearchPathGroups', folderKey, extension, mappedExt)
        .forEach(a => extraSearchPathSet.add(a));

    let extraSearchPathFileListSet = getExtraSearchPathsOrFileLists('extraSearchPathListFiles', folderKey, extension, mappedExt);
    getExtraSearchPathsOrFileLists('extraSearchPathListFileGroups', folderKey, extension, mappedExt)
        .forEach(a => extraSearchPathFileListSet.add(a));

    return [extraSearchPathSet, extraSearchPathFileListSet];
}

function getExtraSearchPathsOrFileLists(configKeyTailName: string, repoFolderName: string, extension: string, mappedExt: string): Set<string> {
    let extraSearchPaths = new Set<string>();
    let extraSearchPathGroups: string[] = [];
    const prefixSet = GetConfigPriorityPrefixes(repoFolderName, extension, mappedExt);
    for (let k = 0; k < prefixSet.length; k++) {
        const configKey = prefixSet[k] + '.' + configKeyTailName;
        const extraPathObject = MyConfig.RepoConfig.get(configKey);
        if (extraPathObject === undefined || extraPathObject === null) {
            continue;
        }

        const valueType = typeof extraPathObject;

        if (valueType === 'string') {
            extraSearchPathGroups = (extraPathObject as string || '').trim().split(SplitPathGroupsRegex).filter(a => a.length > 0);
        } else {
            const pathArray = extraPathObject as string[];
            if (pathArray) {
                pathArray.forEach(a => {
                    a.trim().split(SplitPathGroupsRegex)
                        .filter(a => a.length > 0)
                        .forEach(g => extraSearchPathGroups.push(g));
                });
            }
        }

        break;
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

    const specificPaths = folderNameToPathMap.get(repoFolderName) || '';
    splitPathList(specificPaths).forEach(a => extraSearchPaths.add(a));
    return toStoragePaths(getUniqueStringSetNoCase(extraSearchPaths));
}

function splitPathList(pathListText: string) {
    let extraSearchPaths = new Set<string>();
    if (!pathListText) {
        return extraSearchPaths;
    }

    pathListText.split(SplitPathsRegex).forEach(a => {
        extraSearchPaths.add(a.trim());
    });

    extraSearchPaths = toStoragePaths(getUniqueStringSetNoCase(extraSearchPaths));
    return extraSearchPaths;
}

export function printConfigInfo(config: vscode.WorkspaceConfiguration) {
    outputDebug(`IsWindows = ${IsWindows}, IsWSL = ${IsWSL}, IsLinux = ${IsLinux}, DefaultTerminalType = ${TerminalType[DefaultTerminalType]}`);
    outputDebug(`IsWindowsTerminalOnWindows = ${IsWindowsTerminalOnWindows}, IsLinuxTerminalOnWindows = ${IsLinuxTerminalOnWindows}`);
    outputDebug('msr.enable.definition = ' + config.get('enable.definition'));
    outputDebug('msr.enable.reference = ' + config.get('enable.reference'));
    outputDebug('msr.enable.findingCommands = ' + config.get('enable.findingCommands'));
    outputDebug('msr.quiet = ' + config.get('quiet'));
    outputDebug('msr.debug = ' + config.get('debug'));
    outputDebug('msr.disable.extensionPattern = ' + config.get('disable.extensionPattern'));
    outputDebug('msr.disable.findDef.extensionPattern = ' + config.get('disable.findDef.extensionPattern'));
    outputDebug('msr.disable.projectRepoFolderNamePattern = ' + config.get('disable.projectRepoFolderNamePattern'));
    outputDebug('msr.initProjectCmdAliasForNewTerminals = ' + config.get('initProjectCmdAliasForNewTerminals'));
    outputDebug('msr.autoMergeSkipFolders = ' + config.get('autoMergeSkipFolders'));
}

export function mergeSkipFolderPattern(skipFoldersPattern: string) {
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
            outputDebugByTime('Failed to add exclude folder from settings:' + error);
        }
    }
    else if (isNullOrEmpty(skipFoldersPattern) && MyConfig.ExcludeFoldersFromSettings.size > 0) {
        skipFoldersPattern = '^(' + Array.from(MyConfig.ExcludeFoldersFromSettings).join('|') + ')$';
    }

    return skipFoldersPattern;
}