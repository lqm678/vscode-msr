import * as vscode from 'vscode';
import { getFindTopDistributionCommand, getSortCommandText } from "./commands";
import { getConfigValueByPriorityList, getConfigValueByProjectAndExtension, getConfigValueOfProject } from "./configUtils";
import { getGitInfoTipTemplate, HomeFolder, IsLinux, IsWindows, IsWSL, RunCmdTerminalName } from "./constants";
import { DefaultRootFolder, getConfig, getGitIgnore, getSearchPathOptions, MappedExtToCodeFilePatternMap, MyConfig } from "./dynamicConfig";
import { FindCommandType, TerminalType } from "./enums";
import { createDirectory, readTextFile, saveTextToFile } from './fileUtils';
import { enableColorAndHideCommandLine, outputDebugByTime, outputErrorByTime, outputInfoQuiet, outputInfoQuietByTime, outputWarnByTime } from "./outputUtils";
import { escapeRegExp } from "./regexUtils";
import { runCommandInTerminal, sendCommandToTerminal } from './runCommandUtils';
import { DefaultTerminalType, getTerminalInitialPath, getTerminalNameOrShellExeName, getTerminalShellExePath, isLinuxTerminalOnWindows, IsLinuxTerminalOnWindows, isPowerShellTerminal, isWindowsTerminalOnWindows, toStoragePath, toTerminalPath, toTerminalPathsText } from './terminalUtils';
import { IsFileTimeOffsetSupported, RunCommandChecker, setOutputColumnIndexInCommandLine, ToolChecker } from './ToolChecker';
import { getSetToolEnvCommand } from "./toolSource";
import { getDefaultRootFolderName, getElapsedSecondsToNow, getPowerShellName, getRootFolder, getRootFolderName, getUniqueStringSetNoCase, isNullOrEmpty, quotePaths, replaceSearchTextHolder, replaceTextByRegex } from "./utils";
import { FindJavaSpringReferenceByPowerShellAlias } from './wordReferenceUtils';
import fs = require('fs');
import os = require('os');
import path = require('path');

const CookCmdDocUrl = 'https://github.com/qualiu/vscode-msr/blob/master/README.md#command-shortcuts';

function getLinuxHomeFolderOnWindows(terminalType: TerminalType): string {
  const shellExePath = getTerminalShellExePath();
  const shellExeFolder = path.dirname(shellExePath);
  if (IsWSL || IsLinux) {
    return "~/";
  }

  let folder = path.join(path.dirname(shellExeFolder), 'home', os.userInfo().username);
  if (TerminalType.MinGWBash === terminalType || TerminalType.WslBash === terminalType) {
    const home = process.env['USERPROFILE'] || '';
    if (!isNullOrEmpty(home)) {
      return home;
    }
  }
  return folder.replace(/^home/, '/home');
}

function getCmdAliasSaveFolder(isForProjectCmdAlias: boolean, terminalType: TerminalType, forceUseDefault = false): string {
  const rootConfig = getConfig().RootConfig;
  let saveFolder = isForProjectCmdAlias ? os.tmpdir() : toStoragePath(forceUseDefault ? HomeFolder : (rootConfig.get('cmdAlias.saveFolder') as string || HomeFolder));

  // avoid random folder in Darwin like: '/var/folders/7m/f0z72nfn3nn6_mnb_0000gn/T'
  if (isForProjectCmdAlias && saveFolder.startsWith('/')) {
    saveFolder = '/tmp/';
  }

  if (!isForProjectCmdAlias && !isLinuxTerminalOnWindows(terminalType)) {
    const linuxHomeFolderOnWindows = getLinuxHomeFolderOnWindows(terminalType);
    if (saveFolder.match(/^[A-Z]:/i) && (IsWSL || TerminalType.CygwinBash === terminalType || TerminalType.MinGWBash === terminalType)) {
      try {
        if (!fs.existsSync(linuxHomeFolderOnWindows)) {
          fs.mkdirSync(linuxHomeFolderOnWindows);
        }
        saveFolder = linuxHomeFolderOnWindows;
      } catch (error) {
        outputDebugByTime('Failed to create folder: ' + linuxHomeFolderOnWindows + ' for Linux terminal on Windows.');
      }
    }
  }

  return saveFolder;
}

export function getGeneralCmdAliasFilePath(terminalType: TerminalType) {
  const isWindowsTerminal = isWindowsTerminalOnWindows(terminalType);
  const saveFolder = getCmdAliasSaveFolder(false, terminalType);
  const fileName = 'msr-cmd-alias' + (isWindowsTerminal ? '.doskeys' : '.bashrc');

  // if is WSL and first time, which read Windows settings.
  if (IsWSL && saveFolder.match(/^[A-Z]:/i)) {
    return path.join(HomeFolder, fileName);
  }

  return path.join(saveFolder, fileName);
}

function getDisplayPathForBash(filePath: string, replaceTo: string = '~'): string {
  const homeValue = process.env['HOME'] || '';
  const pattern = isNullOrEmpty(homeValue)
    ? /^(~|\$HOME)/
    : new RegExp('^(~|\$HOME|' + homeValue + '\\b)');
  return filePath.replace(pattern, replaceTo);
}

function getShellExeAndTerminalType(terminal: vscode.Terminal | undefined, isNewlyCreated = false): [string, TerminalType] {
  const initialPath = getTerminalInitialPath(terminal) || '';
  const shellExe = initialPath.match(/\.exe$|\w*sh$|(Cygwin\S*\.(cmd|bat)$)/i) ? initialPath : getTerminalShellExePath();
  const terminalOrShellName = getTerminalNameOrShellExeName(terminal);
  const exeNameByInitPath = isNullOrEmpty(initialPath) ? '' : path.basename(initialPath);
  const terminalName = !isNullOrEmpty(exeNameByInitPath) ? exeNameByInitPath : terminalOrShellName;

  if (!terminal || terminalName === RunCmdTerminalName) {
    // Avoid error in reloading CMD terminal.
    const terminalType = IsWindows && !isNewlyCreated ? TerminalType.CMD : DefaultTerminalType;
    return [shellExe, terminalType];
  }

  if (IsWindows) {
    if (isNullOrEmpty(shellExe)) {
      if (/PowerShell/i.test(terminalName)) {
        return [shellExe, TerminalType.PowerShell];
      } else if (/bash/i.test(terminalName)) {
        return [shellExe, TerminalType.WslBash];
      } else if (/CMD|Command/i.test(terminalName)) {
        return [shellExe, TerminalType.CMD];
      } else {
        return [shellExe, TerminalType.PowerShell];
      }
    } else {
      if (/cmd.exe$|^Command Prompt/i.test(terminalName || shellExe)) {
        return [shellExe, TerminalType.CMD];
      } else if (/PowerShell.exe$|^PowerShell$/i.test(terminalName || shellExe)) {
        return [shellExe, TerminalType.PowerShell];
      } else if (/Cygwin.*?bin\\bash.exe$|^Cygwin/i.test(shellExe) || /Cygwin\S*\.(bat|cmd)$/i.test(shellExe)) {
        return ['bash', TerminalType.CygwinBash];
      } else if (/System(32)?.bash.exe$|wsl.exe$|^WSL/i.test(shellExe)) {
        return [shellExe, TerminalType.WslBash];
      } else if (/Git\S+bash.exe$|^Git Bash/i.test(shellExe)) { // (shellExe.includes('Git\\bin\\bash.exe'))
        return [shellExe, TerminalType.MinGWBash];
      } else {
        return [shellExe, TerminalType.PowerShell];
      }
    }
  } else {
    if (/PowerShell|pwsh/i.test(terminalName)) {
      return [shellExe, TerminalType.Pwsh];
    } else {
      return [shellExe, TerminalType.LinuxBash];
    }
  }
}

let LastCookTime: Date = new Date();
LastCookTime.setFullYear(LastCookTime.getFullYear() - 1);

export function cookCmdShortcutsOrFile(
  isFromMenu: boolean,
  currentFilePath: string,
  isForProjectCmdAlias: boolean,
  writeToEachFile: boolean,
  terminal: vscode.Terminal | undefined = undefined,
  isNewlyCreated: boolean = false,
  dumpOtherCmdAlias: boolean = false,
  isSelfLoopCalling: boolean = false,
  onlyCookFile: boolean = false) {
  if (!RunCommandChecker.IsToolExists) {
    return;
  }

  const defaultRootFolderName = getDefaultRootFolderName();
  if (isNullOrEmpty(defaultRootFolderName)) {
    return;
  }

  const trackBeginTime = new Date();
  const elapseSeconds = getElapsedSecondsToNow(LastCookTime);
  LastCookTime = new Date();
  const isTooCloseCooking = elapseSeconds <= 5 && !isFromMenu && !isNewlyCreated;

  // TODO: Refactor to compose-alias + write-files + different-os-terminals
  outputDebugByTime('Begin cooking command shortcuts for terminal ' + (terminal ? terminal.name : ''));
  const [shellExe, terminalType] = getShellExeAndTerminalType(terminal, isNewlyCreated);
  const shellExeName = path.basename(shellExe).replace(/\.exe$/i, ''); // Remove .exe for Linux bash on Windows.
  const shellSettingsFile = "~/." + (isNullOrEmpty(shellExeName) ? 'bash' : shellExeName) + "rc";
  const loadShellSettingsCommand = `source ${shellSettingsFile}`;
  const shellExeFolder = path.dirname(shellExe);
  const isRunCmdTerminal = terminal !== undefined && terminal != null && terminal.name === RunCmdTerminalName;
  const isNewlyCreatedRunCmdTerminal = isNewlyCreated && isRunCmdTerminal;
  const isWindowsTerminal = isWindowsTerminalOnWindows(terminalType);
  const isLinuxTerminalOnWindows = IsWindows && !isWindowsTerminal;
  const generalScriptFilesFolder = path.join(getCmdAliasSaveFolder(false, terminalType), 'cmdAlias');
  const rootFolder = isRunCmdTerminal && !onlyCookFile ? DefaultRootFolder : getRootFolder(currentFilePath, isForProjectCmdAlias);
  const rootFolderName = getRootFolderName(rootFolder);
  if (isPowerShellTerminal(terminalType) && MyConfig.canUseGoodGitIgnore(rootFolder)) {
    const testScriptName = isWindowsTerminal && IsWindows ? 'gfind-all.cmd' : 'gfind-all';
    const testPath = path.join(generalScriptFilesFolder, testScriptName);
    if (!isSelfLoopCalling && !fs.existsSync(testPath)) {
      cookCmdShortcutsOrFile(isFromMenu, currentFilePath, false, true, terminal, false, false, true);
    }
  }

  const saveFolder = getCmdAliasSaveFolder(isForProjectCmdAlias, terminalType);
  if (isNullOrEmpty(rootFolderName) && !terminal) {
    isForProjectCmdAlias = false;
  }

  const singleScriptsSaveFolder = toStoragePath(generalScriptFilesFolder);
  const singleScriptsFolderOsPath = toTerminalPath(singleScriptsSaveFolder, terminalType);

  const [cmdAliasMap, oldCmdCount, _commands] = getCommandAliasMap(terminalType, rootFolder, isForProjectCmdAlias, writeToEachFile, dumpOtherCmdAlias);
  const cmdAliasFileNameForDefault = 'msr-cmd-alias' + (isWindowsTerminal ? '.doskeys' : '.bashrc');
  const cmdAliasFileNameForProject = defaultRootFolderName + '.' + cmdAliasFileNameForDefault;
  const tmpStorageFolder = getCmdAliasSaveFolder(true, DefaultTerminalType);
  const projectAliasFilePath = toStoragePath(path.join(tmpStorageFolder, cmdAliasFileNameForProject));
  const tipFileStoragePath = toStoragePath(path.join(tmpStorageFolder, 'tip-guide')) + (isWindowsTerminal ? '.cmd' : ".sh");
  const tipFileDisplayPath = toTerminalPath(tipFileStoragePath, terminalType);
  const fileName = isForProjectCmdAlias ? cmdAliasFileNameForProject : cmdAliasFileNameForDefault;
  const cmdAliasFile = toStoragePath(path.join(saveFolder, fileName));
  const quotedCmdAliasFile = quotePaths(toTerminalPath(cmdAliasFile, terminalType));
  const defaultCmdAliasFile = getGeneralCmdAliasFilePath(terminalType);
  let toolToOpen = 'code';
  if (isWindowsTerminal) {
    const aliasBody = 'doskey /macros 2>&1 | msr -PI -t "^(%1)"';
    const existingOpenDoskey = cmdAliasMap.get('open-doskeys') as string || '';
    const matchTool = /=(\w+\S+|"\w+.*?")/.exec(existingOpenDoskey);
    toolToOpen = isNullOrEmpty(existingOpenDoskey) || !matchTool ? 'code' : matchTool[1];
    cmdAliasMap.set('alias', getCommandAliasText('alias', aliasBody, false, TerminalType.CMD, writeToEachFile));

    cmdAliasMap.set('malias', getCommandAliasText('malias', aliasBody, false, TerminalType.CMD, writeToEachFile));
  } else if (!isWindowsTerminal) {
    cmdAliasMap.set('malias', getCommandAliasText('malias', 'alias | msr -PI -t "^(?:alias\\s+)?($1)"', true, TerminalType.WslBash, writeToEachFile));
  }

  const defaultCmdAliasFileForTerminal = toTerminalPath(defaultCmdAliasFile, terminalType);
  const slashQuotedDefaultCmdAliasFile = defaultCmdAliasFileForTerminal.includes(' ') ? '\\"' + defaultCmdAliasFileForTerminal + '\\"' : defaultCmdAliasFileForTerminal;
  const defaultCmdAliasFileDisplayPath = toTerminalPath(defaultCmdAliasFile, terminalType);
  const quotedDefaultAliasFileForDisplay = quotePaths(toTerminalPath(defaultCmdAliasFile, terminalType));
  const quotedCmdAliasFileForDisplay = quotePaths(toTerminalPath(cmdAliasFile, terminalType));

  function addOpenUpdateCmdAlias(aliasFilePath: string, updateName: string = 'update-alias', openName: string = 'open-alias') {
    const updateDoskeyText = isWindowsTerminal
      ? (writeToEachFile ? `doskey /MACROFILE=${aliasFilePath}` : `${updateName}=doskey /MACROFILE=${aliasFilePath}`)
      : (writeToEachFile ? `source ${aliasFilePath}` : `alias ${updateName}='source ${aliasFilePath}'`);

    const openDoskeyText = isWindowsTerminal
      ? (writeToEachFile ? `${toolToOpen} ${aliasFilePath}` : `${openName}=${toolToOpen} ${aliasFilePath}`)
      : (writeToEachFile ? `${toolToOpen} ${aliasFilePath}` : `alias ${openName}='${toolToOpen} ${aliasFilePath}'`);

    cmdAliasMap.set(updateName, updateDoskeyText);
    cmdAliasMap.set(openName, openDoskeyText);
  }

  addOpenUpdateCmdAlias(quotedDefaultAliasFileForDisplay, 'update-alias', 'open-alias');
  if (isWindowsTerminal) { // support old shortcut name
    addOpenUpdateCmdAlias(quotedDefaultAliasFileForDisplay, 'update-doskeys', 'open-doskeys');
  }

  const tmpAliasSaveFolder = toTerminalPath(getCmdAliasSaveFolder(true, terminalType), terminalType);
  const useThisAliasBody = isWindowsTerminal
    ? String.raw`for /f "tokens=*" %a in ('msr -z "%CD%" -t ".*?([^\\/]+)$" -o "\1" -aPAC ^| msr -t "[^\w\.-]" -o "-" -aPAC') do echo doskey /MACROFILE="%tmp%\%a.msr-cmd-alias.doskeys" | msr -XM`
    : (TerminalType.MinGWBash === terminalType
      ? String.raw`thisFile=$(msr -z $PWD -t ".*?([^/]+)$" -o "/tmp/\1.msr-cmd-alias.bashrc" -PAC); echo source $thisFile; source $thisFile;`
      : String.raw`thisFile=/tmp/$(msr -z $PWD -t ".*?([^/]+)$" -o "\1.msr-cmd-alias.bashrc" -PAC); echo source $thisFile; source $thisFile;`
    );

  const useThisAliasForScript = getCommandAliasText('use-this-alias', useThisAliasBody, true, terminalType, true, true);
  createDirectory(singleScriptsSaveFolder) && writeOneAliasToFile('use-this-alias', useThisAliasForScript, true);

  const openThisAliasBody = useThisAliasBody.replace(/doskey\W+MACROFILE=|source (?<=\$thisFile)/g, 'code ');
  cmdAliasMap.set('use-this-alias', getCommandAliasText('use-this-alias', useThisAliasBody, true, terminalType, writeToEachFile, true));
  cmdAliasMap.set('open-this-alias', getCommandAliasText('open-this-alias', openThisAliasBody, true, terminalType, writeToEachFile, true));
  if (isForProjectCmdAlias && !isNullOrEmpty(rootFolderName)) {
    const tmpName = rootFolderName.replace(/[^\w\.-]/g, '-').toLowerCase();
    addOpenUpdateCmdAlias(quotedCmdAliasFileForDisplay, 'update-' + tmpName + '-alias', 'open-' + tmpName + '-alias');
    if (isWindowsTerminal) { // keep old shortcut name
      addOpenUpdateCmdAlias(quotedCmdAliasFileForDisplay, 'update-' + tmpName + '-doskeys', 'open-' + tmpName + '-doskeys');
    }
  }

  // list-alias + use-alias
  const tmpBody = 'msr -l --wt --sz -p ' + quotePaths(tmpAliasSaveFolder) + ' -f "' + cmdAliasFileNameForDefault + '$" $*';
  cmdAliasMap.set('list-alias', getCommandAliasText('list-alias', tmpBody, true, terminalType, false, false));
  const useBody = isWindowsTerminal ? 'doskey /MACROFILE=$1' : 'source $1';
  cmdAliasMap.set('use-alias', getCommandAliasText('use-alias', useBody, true, terminalType, false, false));

  [FindCommandType.FindTopFolder, FindCommandType.FindTopType, FindCommandType.FindTopSourceFolder, FindCommandType.FindTopSourceType, FindCommandType.FindTopCodeFolder, FindCommandType.FindTopCodeType].forEach(findTopCmd => {
    const findTopBody = getFindTopDistributionCommand(false, isForProjectCmdAlias, true, findTopCmd, rootFolder);
    let aliasName = replaceTextByRegex(FindCommandType[findTopCmd], /([a-z])([A-Z])/g, '$1-$2');
    aliasName = replaceTextByRegex(aliasName, /^-|-$/g, '').toLowerCase();
    cmdAliasMap.set(aliasName, getCommandAliasText(aliasName, findTopBody, false, terminalType, writeToEachFile, false, false));
  });

  [FindCommandType.SortBySize, FindCommandType.SortByTime, FindCommandType.SortSourceBySize, FindCommandType.SortSourceByTime, FindCommandType.SortCodeBySize, FindCommandType.SortCodeByTime].forEach(sortCmd => {
    const sortBody = getSortCommandText(false, isForProjectCmdAlias, true, sortCmd, rootFolder, true);
    let aliasName = replaceTextByRegex(FindCommandType[sortCmd], /([a-z])([A-Z])/g, '$1-$2');
    aliasName = replaceTextByRegex(aliasName, /^-|-$/g, '').toLowerCase();
    cmdAliasMap.set(aliasName, getCommandAliasText(aliasName, sortBody, false, terminalType, writeToEachFile, false, false));
  });

  const useFullPathsBody = getPathCmdAliasBody(true, cmdAliasFile, false);
  cmdAliasMap.set('use-fp', getCommandAliasText('use-fp', useFullPathsBody, false, terminalType, writeToEachFile, false, false));
  const searchRelativePathsBody = getPathCmdAliasBody(false, cmdAliasFile, false);
  cmdAliasMap.set('use-rp', getCommandAliasText('use-rp', searchRelativePathsBody, false, terminalType, writeToEachFile, false, false));

  const outFullPathsBody = getPathCmdAliasBody(true, cmdAliasFile, true, true);
  cmdAliasMap.set('out-fp', getCommandAliasText('out-fp', outFullPathsBody, false, terminalType, writeToEachFile, false, false));
  const outRelativePathsBody = getPathCmdAliasBody(false, cmdAliasFile, true, false);
  cmdAliasMap.set('out-rp', getCommandAliasText('out-rp', outRelativePathsBody, false, terminalType, writeToEachFile, false, false));

  const tmpFileName = isForProjectCmdAlias
    ? 'tmp-list-' + (rootFolderName + '-' + path.basename(path.dirname(rootFolder))).replace(/[^\w\.-]/, '-')
    : 'tmp-git-file-list';

  // Duplicate find-xxx to git ls-file & find-xxx; except find-nd / find-ndp
  const sortedCmdKeys = Array.from(cmdAliasMap.keys()).sort();
  sortedCmdKeys.forEach(key => {
    const value = cmdAliasMap.get(key) || '';
    const powerShellCmd = getPowerShellName(terminalType) + ' -Command';
    if (key.match(/^(find|sort)-/) && !key.startsWith('find-nd') && value.includes('msr -rp')) {
      const isPowerShellScript = value.includes(powerShellCmd); // like find-spring-ref
      const tmpListFile = isPowerShellScript && isWindowsTerminal
        ? path.join(os.tmpdir(), tmpFileName)
        : quotePaths((isWindowsTerminal ? '%tmp%\\' : '/tmp/') + tmpFileName);

      const listFileCommand = 'git ls-files --recurse-submodules > ' + tmpListFile;
      let checkAndListCommand = listFileCommand + (isPowerShellScript ? '; ' : ' && ');
      const refreshDuration = MyConfig.RefreshTmpGitFileListDuration;
      if (isForProjectCmdAlias && IsFileTimeOffsetSupported) {
        const checkTime = `msr -l --w1 ${refreshDuration} -p ${tmpListFile}`;
        if (isPowerShellScript) {
          checkAndListCommand = '$foundFile = ' + checkTime + ' -PAC 2>$null; if ([string]::IsNullOrEmpty($foundFile)) { ' + listFileCommand + ' }';
          if (!isWindowsTerminal) {
            checkAndListCommand = checkAndListCommand.replace(/\$(\w+)/g, '\\$$$1');
          }
        } else {
          if (isWindowsTerminal) {
            checkAndListCommand = '( ' + checkTime + ' 2>nul | msr -t "^Matched 1" >nul && ' + listFileCommand + ' ) & ';
          } else {
            checkAndListCommand = checkTime + ' 2>/dev/null -PAC 1>&2; [ $? -ne 1 ] && ' + listFileCommand + '; '
          }
        }
      }

      let newCommand = value.replace(/msr -rp\s+(".+?"|\S+)/, checkAndListCommand.trimRight() + ' msr -w ' + tmpListFile)
        .replace(/\s+(--nd|--np)\s+".+?"\s*/, ' ');
      if (isWindowsTerminal) {
        newCommand = newCommand.replace(new RegExp('^' + key), 'g' + key);
      } else {
        newCommand = newCommand.replace(new RegExp('^alias\\s+' + key), 'alias g' + key)
      }
      cmdAliasMap.set('g' + key, newCommand);
    }
  });

  const skipWritingScriptNames = new Set<string>(['use-fp', 'use-rp', 'out-rp', 'out-fp', 'alias']);
  const failedToCreateSingleScriptFolder = writeToEachFile && !createDirectory(singleScriptsSaveFolder);
  let allCmdAliasText = ''; // writeToEachFile || isWindowsTerminal || !isForProjectCmdAlias ? '' : 'source /etc/profile; source ~/.bashrc' + '\n\n';
  let writeScriptFailureCount = 0;
  const sortedKeys = Array.from(cmdAliasMap.keys()).sort();
  sortedKeys.forEach(key => {
    let scriptContent = cmdAliasMap.get(key) || '';
    if (writeToEachFile) {
      if (!failedToCreateSingleScriptFolder && !skipWritingScriptNames.has(key) && (dumpOtherCmdAlias || key.match(/^(g?find|sort)-|malias/))) {
        if (!writeOneAliasToFile(key, scriptContent)) {
          writeScriptFailureCount++;
        }
      }
    } else {
      allCmdAliasText += scriptContent + (isWindowsTerminal ? '\r\n\r\n' : '\n\n');
    }
  });

  // If use echo command, should use '\\~' instead of '~'
  const defaultAliasPathForBash = getDisplayPathForBash(defaultCmdAliasFileDisplayPath, '~'); // '\\~');
  const createCmdAliasTip = `You can create shortcuts in ${defaultAliasPathForBash}${isWindowsTerminal ? '' : ' or other files'} . `;
  const replaceTipValueArg = `-x S#C -o ${cmdAliasMap.size}`;
  const shortcutsExample = 'Now you can use S#C shortcuts like find-all gfind-all gfind-small find-def gfind-ref find-doc find-spring-ref'
    + ' , find-top-folder gfind-top-type sort-code-by-time etc. See detail like: alias find-def or malias find-top or malias use-fp or malias sort-.+?= etc.';
  const finalGuide = createCmdAliasTip + shortcutsExample + ' You can change msr.skipInitCmdAliasForNewTerminalTitleRegex in user settings.'
    + ' Toggle-Enable/Disable finding definition + Speed-Up-if-Slowdown-by-Windows-Security + Adjust-Color + Fuzzy-Code-Mining + Preview-And-Replace-Files + Hide/Show-Menus'
    + ' + Use git-ignore + Use in external terminals/IDEs: use-this-alias / list-alias / out-fp / out-rp + More functions/details see doc like: ' + CookCmdDocUrl;

  const colorPattern = 'PowerShell|re-cook|\\d+|m*alias|doskey|find-\\S+|sort-\\S+|out-\\S+|use-\\S+|msr.skip\\S+|\\S+-alias\\S*|other'
    + '|Toggle|Enable|Disable|Speed-Up|Adjust-Color|Code-Mining|Preview-|-Replace-|git-ignore|Menus|functions|details';

  if (writeToEachFile) {
    if (!failedToCreateSingleScriptFolder && writeScriptFailureCount < cmdAliasMap.size) {
      outputCmdAliasGuide(terminal ? getGeneralCmdAliasFilePath(terminalType) : cmdAliasFile, saveFolder);
      let setPathCmd = 'msr -z "' + (isWindowsTerminal ? '%PATH%;' : '$PATH:') + '" -ix "' + singleScriptsFolderOsPath + '" >'
        + (isWindowsTerminal ? 'nul' : '/dev/null') + ' && ';
      if (isWindowsTerminal) {
        setPathCmd += 'SET "PATH=%PATH%;' + singleScriptsSaveFolder + ';"';
      } else {
        setPathCmd += 'export PATH=$PATH:' + singleScriptsFolderOsPath;
      }

      runCmdInTerminal(setPathCmd, true);
      if (isWindowsTerminal) {
        runCmdInTerminal('where find-def.cmd', false);
        runCmdInTerminal('where find-def', false);
      } else {
        runCmdInTerminal('chmod +x ' + singleScriptsFolderOsPath + (dumpOtherCmdAlias ? '/*' : '/find*'), false);
        // const cmdHead = TerminalType.MinGWBash === terminalType ? 'alias ' : 'which ';
        // runCmdInTerminal(cmdHead + 'find-def', false);
        // runCmdInTerminal(cmdHead + 'find-ref', false);
      }
    }

    if (writeScriptFailureCount > 0) {
      outputInfoQuietByTime('Total = ' + cmdAliasMap.size + ', failures = ' + writeScriptFailureCount + ', made ' + (cmdAliasMap.size - writeScriptFailureCount) + ' command alias/doskey script files saved in: ' + singleScriptsSaveFolder);
    } else {
      outputInfoQuietByTime('Successfully made ' + cmdAliasMap.size + ' command alias/doskey script files and saved in: ' + singleScriptsSaveFolder);
    }
  } else {
    const existedText = readTextFile(cmdAliasFile);
    const hasChanged = allCmdAliasText !== existedText;
    if (hasChanged) {
      if (!isNullOrEmpty(existedText) && terminal && !MyConfig.OverwriteProjectCmdAliasForNewTerminals) {
        outputDebugByTime(`Found msr.overwriteProjectCmdAliasForNewTerminals = false, Skip writing temp command shortcuts file: ${cmdAliasFile}`);
      } else {
        if (!saveTextToFile(cmdAliasFile, allCmdAliasText, 'command alias file')) {
          return;
        }
      }
    }

    if (!terminal || (isRunCmdTerminal && MyConfig.IsDebug)) {
      outputCmdAliasGuide(terminal ? getGeneralCmdAliasFilePath(terminalType) : cmdAliasFile, '');
      const existingInfo = isWindowsTerminal ? ' (merged existing = ' + oldCmdCount + ')' : '';
      outputInfoQuietByTime((hasChanged ? 'Successfully made ' : 'Already has same ') + cmdAliasMap.size + existingInfo + ' command alias/doskey file at: ' + cmdAliasFile);
      outputInfoQuietByTime('To more freely use them (like in scripts or nested command line pipe): Press `F1` search `msr Cook` and choose cooking script files. (You can make menu `msr.cookCmdAliasFiles` visible).');
    }

    if (defaultCmdAliasFile !== cmdAliasFile && !fs.existsSync(defaultCmdAliasFile)) {
      fs.copyFileSync(cmdAliasFile, defaultCmdAliasFile);
    }

    if (onlyCookFile) {
      return;
    }

    if (terminal && isWindowsTerminal) {
      if (TerminalType.CMD !== terminalType && TerminalType.PowerShell !== terminalType) {
        outputErrorByTime('Not supported terminal: ' + terminal.name + ', shellExe = ' + shellExe);
        runCmdInTerminal('echo Not supported terminal: ' + terminal.name + ', shellExe = ' + shellExe);
        // fs.unlinkSync(cmdAliasFile);
        return;
      }

      // Powershell PSReadLine module is not compatible with doskey
      if (TerminalType.PowerShell === terminalType && isNewlyCreatedRunCmdTerminal) {
        const setEnvCmd = getSetToolEnvCommand(TerminalType.PowerShell, '; ', [generalScriptFilesFolder]);
        runCmdInTerminal(setEnvCmd, true);
        // workaround for unknown shell case on Windows when reloading/reusing MSR-RUN-CMD terminal.
        if (isRunCmdTerminal) {
          const setEnvCmd = getSetToolEnvCommand(TerminalType.CMD, ' ', [generalScriptFilesFolder]);
          runCmdInTerminal(setEnvCmd, true);
        }
      }
    }
  }

  if (isWindowsTerminal) {
    if (!isTooCloseCooking) {
      const setEnvCmd = getSetToolEnvCommand(terminalType, '', [generalScriptFilesFolder]);
      setEnvAndLoadCmdAlias('doskey /MACROFILE="' + cmdAliasFile + '"', false, setEnvCmd);
    }
    if (isFromMenu) {
      const regCmd = 'REG ADD "HKEY_CURRENT_USER\\Software\\Microsoft\\Command Processor" /v Autorun /d "DOSKEY /MACROFILE=' + slashQuotedDefaultCmdAliasFile + '" /f';
      runCmdInTerminal(regCmd, true);
    }
  } else {
    if (isNewlyCreated) {
      if (isLinuxTerminalOnWindows) {
        if (isNewlyCreatedRunCmdTerminal) {
          let envPathSet = new Set<string>().add(shellExeFolder);
          (process.env['PATH'] || '').split(/\\?\s*;\s*/).forEach(a => envPathSet.add(a));
          envPathSet = getUniqueStringSetNoCase(envPathSet, true);
          process.env['PATH'] = Array.from(envPathSet).join(';');
          runCmdInTerminal(quotePaths(shellExe));
        }
        runCmdInTerminal('export PATH=/usr/bin:$PATH:~');
      }

      prepareEnvForLinuxTerminal(terminalType);
    } else if (TerminalType.Pwsh !== terminalType) {
      setEnvAndLoadCmdAlias('source ' + quotePaths(toTerminalPath(cmdAliasFile, terminalType)), true, loadShellSettingsCommand);
    }

    if (shellExeName !== 'pwsh') {
      // If file not found: Windows = -1; MinGW = 127; Linux = 255
      runCmdInTerminal(`msr -p ${shellSettingsFile} 2>/dev/null -x 'source ${defaultAliasPathForBash}' -M; (($? == 0 || $? == -1 || $? == 255 || $? == 127)) && echo 'source ${defaultAliasPathForBash}' >> ${shellSettingsFile}`);
    }
  }

  if (isPowerShellTerminal(terminalType) && RunCommandChecker.IsToolExists) {
    runPowerShellShowFindCmdLocation(MyConfig.canUseGoodGitIgnore(rootFolder) ? "^g?find-\\w+-def" : "^(update|open|use)-\\S*alias");
  }

  if (!RunCommandChecker.IsToolExists) {
    return;
  }


  // MacBook terminal messy with long tip //!IsMacOS || (isFromMenu && !IsMacOS) || (!isRunCmdTerminal && (!isFromMenu || !IsMacOS));
  const showLongTip = MyConfig.ShowLongTip && !isTooCloseCooking;
  if (TerminalType.PowerShell === terminalType && IsWindows && !MyConfig.canUseGoodGitIgnore(rootFolder)) {
    const setEnvCmd = getSetToolEnvCommand(terminalType, '; ', [generalScriptFilesFolder]);
    const quotedFileForPS = (quotedCmdAliasFile === cmdAliasFile ? cmdAliasFile : '`"' + cmdAliasFile + '`"').replace(os.tmpdir(), '%TMP%');
    runCmdInTerminal(setEnvCmd);
    const cmd = `cmd /k "doskey /MACROFILE=${quotedFileForPS}`
      + ` & call ${tipFileDisplayPath.replace(os.tmpdir(), '%TMP%')} ${replaceTipValueArg}`
      + ` & echo Type exit to back to PowerShell.| msr -aPA -e .+ -x exit"`;
    runCmdInTerminal(cmd, true);
  } else if (TerminalType.Pwsh === terminalType && !MyConfig.canUseGoodGitIgnore(rootFolder)) {
    runPowerShellShowFindCmdLocation();
    showTipByCommand(showLongTip);
    runCmdInTerminal('bash --init-file ' + quotedCmdAliasFile);
  } else {
    if (!isPowerShellTerminal(terminalType) && !isTooCloseCooking) {
      if (isWindowsTerminal) {
        runCmdInTerminal('malias "update-\\S*alias^|open-\\S*alias^|use-\\S*alias" -e "(.:.+)" -M -H 2 -T2', true);
      } else {
        runCmdInTerminal('malias "update-\\S*alias|open-\\S*alias|use-\\S*alias" --nt function -e "(.:.+|[~/].+\\w+)" -M -H 2 -T2', true);
      }
    }
    showTipByCommand(showLongTip);
  }

  outputDebugByTime('Finished to cook command shortcuts. Cost ' + getElapsedSecondsToNow(trackBeginTime) + ' seconds.');
  if (!isForProjectCmdAlias && (isRunCmdTerminal || isFromMenu)) {
    if (isWindowsTerminal) {
      runCmdInTerminal('doskey /MACROFILE="' + projectAliasFilePath + '"');
    } else {
      runCmdInTerminal('source "' + projectAliasFilePath + '"');
    }
  }

  function runPowerShellShowFindCmdLocation(searchFileNamePattern = "^g?find-\\w+-def") {
    if (fs.existsSync(generalScriptFilesFolder)) {
      runCmdInTerminal('msr -l --wt --sz -p ' + quotePaths(generalScriptFilesFolder) + ` -f "${searchFileNamePattern}" -H 2 -T2 -M`);
    } else {
      runCmdInTerminal('echo "Please cook command alias/doskeys (by menu of right-click) to generate and use find-xxx in external IDEs or terminals."');
    }
  }

  function writeOneAliasToFile(name: string, scriptContent: string, checkAndSkip = false): boolean {
    const singleScriptPath = path.join(singleScriptsSaveFolder, isWindowsTerminal ? name + '.cmd' : name);
    if (checkAndSkip && fs.existsSync(singleScriptPath)) {
      return true;
    }

    if (isWindowsTerminal) {
      const head = (MyConfig.AddEchoOffWhenCookingWindowsCommandAlias + os.EOL + MyConfig.SetVariablesToLocalScopeWhenCookingWindowsCommandAlias).trim();
      scriptContent = (head.length > 0 ? head + os.EOL : head) + replaceForLoopVariableOnWindows(scriptContent)
    }

    if (!isWindowsTerminal) {
      scriptContent = '#!/bin/bash' + '\n' + scriptContent;
    }

    return saveTextToFile(singleScriptPath, scriptContent.trim() + (isWindowsTerminal ? '\r\n' : '\n'), 'single command alias script file');
  }

  function showTipByCommand(showTip: boolean) {
    if (!showTip) {
      return;
    }

    // const colorPatternForCmdEscape = colorPattern.replace(/\|/g, '^|');
    const lineSep = (isWindowsTerminal ? "\r\n::" : "\n#") + " ";
    const colorCmd = ` | msr -aPA -ix ignored -e "\\d+|Skip\\w+|g?find-\\w+|MSR-\\S+"`;
    const gitInfoTemplate = getGitInfoTipTemplate(isWindowsTerminal);
    const expectedContent = (isWindowsTerminal ? '@' : '') + `msr -aPA -e .+ -z "${finalGuide}" -it "${colorPattern}" ` + (isWindowsTerminal ? '%*' : '$*')
      + lineSep + gitInfoTemplate + " Free to use gfind-xxx / find-xxx." + colorCmd + ` -t "[1-9]\\d* e\\w+"`
      + lineSep + gitInfoTemplate + " Please use gfind-xxx instead of find-xxx for git-exemptions." + colorCmd + ` -t "[1-9]\\d* e\\w+|MSR-\\S+|\\bfind-\\S+"`
      ;

    let shouldWrite = !fs.existsSync(tipFileStoragePath);
    if (!shouldWrite) {
      const tipContent = readTextFile(tipFileStoragePath).trim();
      shouldWrite = isNullOrEmpty(tipContent) || tipContent !== expectedContent;
    }

    if (shouldWrite && !saveTextToFile(tipFileStoragePath, expectedContent)) {
      return;
    }

    runCmdInTerminal(`${isWindowsTerminal ? "" : "sh"} ${quotePaths(tipFileDisplayPath)} ${replaceTipValueArg}`);
  }

  function prepareEnvForLinuxTerminal(terminalType: TerminalType) {
    if (isLinuxTerminalOnWindows) {
      const shouldUseDownload = /^(Git Bash|Cygwin)/i.test(shellExe);
      if (terminal || shouldUseDownload) {
        const downloadCommands = [
          new ToolChecker(terminalType).getCheckDownloadCommandsForLinuxBashOnWindows('msr', shouldUseDownload),
          new ToolChecker(terminalType).getCheckDownloadCommandsForLinuxBashOnWindows('nin', shouldUseDownload)
        ].filter(a => !isNullOrEmpty(a));

        downloadCommands.forEach(c => runCmdInTerminal(c));
      }
    }

    let setEnvCmd: string = getSetToolEnvCommand(terminalType, ' ; ', [generalScriptFilesFolder]);
    const shellExeFolderOsPath = toTerminalPath(shellExeFolder, terminalType);
    const envPath = process.env['PATH'] || '';
    if ((TerminalType.MinGWBash === terminalType || TerminalType.CygwinBash === terminalType)
      && !isNullOrEmpty(envPath) && !isNullOrEmpty(shellExeFolderOsPath) && shellExeFolderOsPath !== '.' && !envPath.includes(shellExeFolderOsPath)) {
      // Avoid MinGW prior to Cygwin when use Cygwin bash.
      if (isNullOrEmpty(setEnvCmd)) {
        setEnvCmd = 'export PATH=' + shellExeFolderOsPath + ':$PATH; ';
      } else {
        setEnvCmd = setEnvCmd.replace('export PATH=', 'export PATH=' + shellExeFolderOsPath + ':');
      }
    }

    if (TerminalType.Pwsh === terminalType) {
      setEnvCmd += (isNullOrEmpty(setEnvCmd) ? '' : '; ')
        + '$env:PATH = $env:HOME + ":" + $env:PATH + ":" + "' + generalScriptFilesFolder + '"';
    } else {
      // Avoid msr.exe prior to msr.cygwin or msr.gcc48
      if (isNullOrEmpty(setEnvCmd)) {
        setEnvCmd = 'export PATH=~:$PATH';
      } else {
        setEnvCmd = setEnvCmd.replace('export PATH=', 'export PATH=~:');
      }
    }

    const envRootFolder = path.dirname(path.dirname(shellExe)).replace(/([^\\])(\\{1})([^\\]|$)/g, '$1$2$2$3');
    const bashFolderValue = envRootFolder === '.' ?
      String.raw`$(where bash.exe | head -n 1 | sed 's#\\[a-z]\+.exe##' | sed 's#usr.bin##' | sed 's/\\$//')`
      : quotePaths(envRootFolder);
    if (TerminalType.CygwinBash === terminalType) {
      setEnvCmd += '; export CYGWIN_ROOT=' + bashFolderValue;
    } else if (TerminalType.MinGWBash === terminalType) {
      setEnvCmd += '; export MINGW_ROOT=' + bashFolderValue;
    }

    const allCmd = TerminalType.Pwsh === terminalType
      ? ''
      : loadShellSettingsCommand + '; source ' + quotePaths(toTerminalPath(cmdAliasFile, terminalType));
    setEnvAndLoadCmdAlias(allCmd, false, setEnvCmd);
  }

  function getPathCmdAliasBody(useWorkspacePath: boolean, sourceAliasFile: string, onlyForOutput: boolean = false, outputFullPath: boolean = false, useTmpFile: boolean = false): string {
    let sourceFilePath = toTerminalPath(sourceAliasFile, terminalType);
    if (IsLinuxTerminalOnWindows || IsLinux) {
      const linuxHome = toTerminalPath(IsLinux ? HomeFolder : getCmdAliasSaveFolder(false, terminalType, true));
      sourceFilePath = sourceFilePath.replace(linuxHome, '~');
    }
    const tmpSaveFile = !useTmpFile ? quotePaths(sourceFilePath) : quotePaths(sourceFilePath + `-${useWorkspacePath ? "full" : "relative"}.tmp`);
    const replaceHead = `msr -p ` + tmpSaveFile;
    const andText = isWindowsTerminal ? " & " : " ; ";
    const copyCmd = (isWindowsTerminal ? `copy /y ` : `cp `) + quotePaths(sourceFilePath) + ` ` + tmpSaveFile;
    const loadCmdAliasCmd = (isWindowsTerminal ? "doskey /MACROFILE=" : "source ") + tmpSaveFile;

    const useExtraPathsToFindDefinition = getConfigValueByProjectAndExtension(rootFolderName, '', '', 'findDefinition.useExtraPaths') === "true";
    const useExtraPathsToFindReferences = getConfigValueByProjectAndExtension(rootFolderName, '', '', 'findReference.useExtraPaths') === "true";
    const findDefinitionPathOptions = getSearchPathOptions(false, isForProjectCmdAlias, rootFolder, "all", true, useExtraPathsToFindReferences, useExtraPathsToFindDefinition, false, false);
    const findReferencesPathOptions = getSearchPathOptions(false, isForProjectCmdAlias, rootFolder, "all", false, useExtraPathsToFindReferences, useExtraPathsToFindDefinition, false, false);
    const pathsForDefinition = toTerminalPathsText(findDefinitionPathOptions.replace(/\s*-r?p\s+(".+?"|\S+).*/, "$1"), terminalType);
    const pathsForOthers = toTerminalPathsText(findReferencesPathOptions.replace(/\s*-r?p\s+(".+?"|\S+).*/, "$1"), terminalType);
    if (pathsForDefinition.includes(" ") || pathsForOthers.includes(" ")) {
      return "echo Skip due to whitespace found in workspace root paths. | msr -aPA -t .+";
    }

    const commonSkipToUseRelativePath = ` --nt "use-[wr]p|out-[fr]p|find-ndp"`;
    const commonSkipToUseFullPath = commonSkipToUseRelativePath.substring(0, commonSkipToUseRelativePath.length - 1) + `|\\s+(-W|--out-full-path)\\s+"`;

    const headCopyCmd = useTmpFile ? copyCmd + andText : "";
    const tailLoadCmd = andText + loadCmdAliasCmd;

    if (onlyForOutput) {
      // linux function is complex, but it's in a separate tmp alias file, so it's safe.
      const extraCheck = isWindowsTerminal ? ` -x find-` : '';
      if (outputFullPath) {
        return headCopyCmd
          + replaceHead + commonSkipToUseFullPath + extraCheck
          + ` -t "\\bmsr (-w|-rp)"`
          + ` -o "msr -W \\1"`
          + ` -R -c Output full path.`
          + tailLoadCmd;
      } else {
        return headCopyCmd
          + replaceHead + commonSkipToUseRelativePath + extraCheck
          + ` -t "\\bmsr -W (-w|-rp)"`
          + ` -o "msr \\1"`
          + ` -R -c Output relative path.`
          + tailLoadCmd;
      }
    }

    if (isWindowsTerminal) {
      return getWindowsBody();
    }

    return getLinuxBody(true) + andText + getLinuxBody(false);

    function getWindowsBody(): string {
      if (useWorkspacePath) {
        return headCopyCmd
          + replaceHead + ` -t "find-\\S*def"` + commonSkipToUseRelativePath
          + ` -x "msr -rp . "`
          + ` -o "msr -rp ${pathsForDefinition} "`
          + ` -R -c Use workspace paths for all find-def + find-xxx-def`
          + andText + replaceHead + ` -t "find-" --nt "use-[wr]p|out-[fr]p|find-ndp|find-\\S*def" `
          + ` -x "msr -rp . "`
          + ` -o "msr -rp ${pathsForOthers} "`
          + ` -R -c Use workspace paths for others like find-ref or find-doc etc.`
          + tailLoadCmd;
      }

      return headCopyCmd + replaceHead + tailLoadCmd;
    }

    function getLinuxBody(forFunction: boolean) {
      const functionCondition = ` -b "alias find-.*?=.*?function"` + ` -Q "^\\s*\\}"`;
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

      return headCopyCmd + replaceHead + tailLoadCmd;
    }
  }

  function setEnvAndLoadCmdAlias(doskeyOrSourceCmd: string, mergeCmd: boolean, setEnvCmd: string = '') {
    setEnvCmd = setEnvCmd.replace(/;\s*;/g, ';');
    if (mergeCmd) {
      if (!isNullOrEmpty(setEnvCmd)) {
        setEnvCmd += TerminalType.CMD === terminalType ? ' & ' : ' ; ';
      }
      runCmdInTerminal(setEnvCmd + doskeyOrSourceCmd, true);
    } else {
      if (!isNullOrEmpty(setEnvCmd)) {
        runCmdInTerminal(setEnvCmd, true);
      }

      runCmdInTerminal(doskeyOrSourceCmd, true);
    }
  }

  function runCmdInTerminal(cmd: string, showTerminal: boolean = false) {
    const clearAtFirst = MyConfig.ClearTerminalBeforeExecutingCommands;
    if (terminal) {
      sendCommandToTerminal(cmd, terminal, showTerminal, clearAtFirst, isLinuxTerminalOnWindows);
    } else {
      runCommandInTerminal(cmd, showTerminal, clearAtFirst, isLinuxTerminalOnWindows);
    }
  }
}

function getCommandAliasMap(
  terminalType: TerminalType,
  rootFolder: string,
  isForProjectCmdAlias: boolean,
  writeToEachFile: boolean,
  dumpOtherCmdAlias: boolean = false)
  : [Map<string, string>, number, string[]] {

  const rootFolderName = path.basename(rootFolder);
  const isWindowsTerminal = isWindowsTerminalOnWindows(terminalType);
  const projectKey = isForProjectCmdAlias ? (rootFolderName || '') : 'notUseProject';
  let skipFoldersPattern = getConfigValueOfProject(projectKey, 'skipFolders');
  if (isForProjectCmdAlias) {
    skipFoldersPattern = mergeSkipFolderPattern(skipFoldersPattern);
  }

  let fileExtensionMapTypes = Array.from(MappedExtToCodeFilePatternMap.keys());
  if (!fileExtensionMapTypes.includes('py')) {
    fileExtensionMapTypes.push('py');
  }

  const findTypes = ['definition', 'reference'];

  let cmdAliasMap = (writeToEachFile && !dumpOtherCmdAlias)
    ? new Map<string, string>()
    : getExistingCmdAlias(terminalType, writeToEachFile);

  const oldCmdCount = cmdAliasMap.size;

  const gitIgnoreInfo = getGitIgnore(rootFolder);
  const skipFolderPatternForCmdAlias = gitIgnoreInfo.Valid && isForProjectCmdAlias
    ? gitIgnoreInfo.getSkipPathRegexPattern(true, false)
    : ' --nd "' + skipFoldersPattern + '"';

  let commands: string[] = [];
  fileExtensionMapTypes.forEach(ext => {
    if (ext === 'default' || isNullOrEmpty(ext)) {
      return;
    }

    // find-cs find-py find-cpp find-java
    let cmdName = 'find-' + ext.replace(/Files?$/i, '');
    let filePattern = getConfigValueByPriorityList([projectKey + '.' + ext, ext, projectKey], 'codeFiles');
    if (isNullOrEmpty(filePattern)) {
      filePattern = MappedExtToCodeFilePatternMap.get(ext) || '';
    }

    if (isNullOrEmpty(filePattern)) {
      filePattern = '\\.' + escapeRegExp(ext) + '$';
    }

    // msr.definition.extraOptions msr.default.extraOptions
    const extraOption = addFullPathHideWarningOption(getConfigValueByProjectAndExtension(projectKey, ext, ext, 'extraOptions'), writeToEachFile);

    const body = 'msr -rp .' + skipFolderPatternForCmdAlias + ' -f "' + filePattern + '" ' + extraOption;
    commands.push(getCommandAlias(cmdName, body, false));

    findTypes.forEach(fd => {
      // msr.cpp.member.definition msr.py.class.definition msr.default.class.definition msr.default.definition
      let searchPattern = getConfigValueByProjectAndExtension(projectKey, ext, ext, fd);

      if (searchPattern.length > 0) {
        searchPattern = ' -t "' + searchPattern + '"';
      }

      // msr.cpp.member.skip.definition  msr.cpp.skip.definition msr.default.skip.definition
      let skipPattern = getConfigValueByProjectAndExtension(projectKey, ext, ext, 'skip.' + fd);
      if (skipPattern.length > 0) {
        skipPattern = ' --nt "' + skipPattern + '"';
      }

      const newBody = body + skipPattern + searchPattern;
      // find-cpp-def find-java-def find-py-def
      const newCmdName = cmdName + '-' + fd.replace(/^(.{3}).*/, '$1');
      commands.push(getCommandAlias(newCmdName, newBody, true));
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
    let searchPattern = getConfigValueOfProject(projectKey, configKeyForSearch);

    if (searchPattern.length > 0) {
      searchPattern = ' -t "' + searchPattern + '"';
    }

    // msr.cpp.member.skip.definition  msr.cpp.skip.definition msr.default.skip.definition
    const configNamesForSkip = fd === 'all-def' ? ['ui', 'default'] : [projectKey, 'default'];
    let skipPattern = getConfigValueByPriorityList(configNamesForSkip, 'skip.' + configKeyForSkip);
    if (skipPattern.length > 0) {
      skipPattern = ' --nt "' + skipPattern + '"';
    }

    const allFilesPattern = isForProjectCmdAlias ? MyConfig.AllFilesRegex.source : MyConfig.AllFilesDefaultRegex.source;

    // msr.definition.extraOptions msr.default.extraOptions
    const extraOption = addFullPathHideWarningOption(getConfigValueOfProject(projectKey, 'extraOptions'), writeToEachFile);

    let body = 'msr -rp .' + skipFolderPatternForCmdAlias + ' -f "' + allFilesPattern + '" ' + extraOption;
    body += skipPattern + searchPattern;
    commands.push(getCommandAlias(cmdName, body, true));
  });

  // msr.cpp.member.definition msr.py.class.definition msr.default.class.definition msr.default.definition
  const additionalFileTypes = ['allFiles', 'docFiles', 'configFiles', 'scriptFiles'];
  additionalFileTypes.forEach(fp => {
    const filePattern = 'allFiles' === fp
      ? (isForProjectCmdAlias ? MyConfig.AllFilesRegex.source : MyConfig.AllFilesDefaultRegex.source)
      : getConfigValueOfProject(projectKey, fp);

    // find-all
    const cmdName = 'find-' + fp.replace(/[A-Z]\w*$/, '');

    // msr.definition.extraOptions msr.default.extraOptions
    let extraOption = addFullPathHideWarningOption(getConfigValueOfProject(projectKey, 'extraOptions'), writeToEachFile);
    if (/find-config|find-script/.test(cmdName)) {
      extraOption = extraOption.replace(/(^|\s+)--s2\s+\S+\s*/, ' ');
    }

    let body = 'msr -rp .' + skipFolderPatternForCmdAlias + ' -f "' + filePattern + '" ' + extraOption;

    commands.push(getCommandAlias(cmdName, body, true));
  });

  // find-nd find-code find-ndp find-small find-all
  const allCodeFilePattern = isForProjectCmdAlias ? MyConfig.CodeFilesPlusUIRegex.source : MyConfig.CodeFilesPlusUIDefaultRegex.source;
  const extraOption = addFullPathHideWarningOption(getConfigValueOfProject(projectKey, 'extraOptions'), writeToEachFile);
  const skipFoldersForCmd = skipFolderPatternForCmdAlias;
  commands.push(getCommandAlias('find-nd', 'msr -rp .' + skipFoldersForCmd + ' ' + extraOption, false));
  commands.push(getCommandAlias('find-ndp', 'msr -rp %1' + skipFoldersForCmd + ' ' + extraOption, true));
  commands.push(getCommandAlias('find-code', 'msr -rp .' + skipFoldersForCmd + ' -f "' + allCodeFilePattern + '" ' + extraOption, false));

  const allSmallFilesOptions = addFullPathHideWarningOption(getConfigValueOfProject(projectKey, 'allSmallFiles.extraOptions'), writeToEachFile);
  commands.push(getCommandAlias('find-small', 'msr -rp .' + skipFoldersForCmd + ' ' + allSmallFilesOptions, false));

  // find-class
  const findClassFiles = ' -f "' + MyConfig.CodeFilesRegex.source + '"';
  const findClassPattern = ' -t "\\b(class|struct|enum|interface|trait|^\\s*(object|type))\\s+%1"';
  const skipClassPattern = ' --nt "^\\s*(/|throw|return)|%1\\s*;\\s*$"';
  commands.push(getCommandAlias('find-class', 'msr -rp .' + findClassFiles + findClassPattern + skipClassPattern + skipFoldersForCmd + ' ' + extraOption, true));

  // find-spring-ref
  let oneLineCode = FindJavaSpringReferenceByPowerShellAlias.split(/[\r\n]+\s*/).join(' ');
  if (!isWindowsTerminal) {
    oneLineCode = oneLineCode.replace(/(\$[a-z]\w+)/g, '\\$1');
  }

  addFindMemberReferenceCommand('find-cpp-member-ref', 'cpp');
  const findSpringRefCmd = addFindMemberReferenceCommand('find-spring-ref', 'java');
  const findMemberRefCmd = findSpringRefCmd.replace(/\s+-f \S+/, ' ').replace(/find-spring-ref/g, 'find-member-ref').replace(/find_spring_ref/g, 'find_member_ref');
  cmdAliasMap.set('find-member-ref', findMemberRefCmd);
  commands.push(findMemberRefCmd);

  copyAliasForSpecialShortcuts();
  return [cmdAliasMap, oldCmdCount, commands];

  function addFindMemberReferenceCommand(aliasName: string, mappedExtension: string, oneRealExtension: string = '') {
    if (isNullOrEmpty(oneRealExtension)) {
      oneRealExtension = mappedExtension;
    }
    const fileExtPattern = MappedExtToCodeFilePatternMap.get(mappedExtension) || `"\.${oneRealExtension}$"`;
    let psCode: string = oneLineCode.replace(/;\s*$/g, '').trim()
      + '; msr -rp .' + skipFoldersForCmd + " -f '" + fileExtPattern + "'"
      + (isWindowsTerminal ? " -t $pattern " : " -t \\$pattern ") + extraOption;
    if (isWindowsTerminal) {
      psCode = psCode.replace(/"/g, "'").trim();
    } else {
      psCode = psCode.replace(/'/g, '"').replace(/"/g, '\\"').trim();
    }
    let findExtRefCmd = getCommandAliasText(aliasName, psCode, true, terminalType, writeToEachFile, true, true, true);
    if (TerminalType.CygwinBash === terminalType) { // as workaround of running powershell with exe
      findExtRefCmd = findExtRefCmd.replace(/ msr (-+\w+)/g, ' msr.exe $1');
    }
    cmdAliasMap.set(aliasName, findExtRefCmd);
    commands.push(findExtRefCmd);
    return findExtRefCmd;
  }

  function copyAliasForSpecialShortcuts() {
    // find-ts find-js find-vue
    const specialAddedCmdAliasList = ['find-ts', 'find-js', 'find-vue'];
    specialAddedCmdAliasList.forEach(cmdHead => {
      const configPrefix = cmdHead.replace('find-', '');
      const extensions = MyConfig.RootConfig.get(`fileExtensionMap.${configPrefix}`) as string;
      if (isNullOrEmpty(extensions)) {
        return;
      }
      const fileExtensionPattern = `\\.(${extensions.split(/\s+/).join('|')})$`;
      const fileFilter = ` -f "${fileExtensionPattern}"`;
      const findUiDef = cmdAliasMap.get('find-ui-def') || '';
      const findUiRef = cmdAliasMap.get('find-ui-ref') || '';
      const defConfig = MyConfig.RootConfig.get(configPrefix);
      const refConfig = MyConfig.RootConfig.get(configPrefix);
      if (!defConfig && !isNullOrEmpty(findUiDef)) {
        const name = `${cmdHead}-def`;
        const body = findUiDef.replace(/\b(find-ui-def)\b/g, name)
          .replace(/\b(_?find_ui_def)\b/g, '_' + name.replace(/-/g, '_'))
          .replace(/\s+-f\s+"(.+?)"/, fileFilter);
        cmdAliasMap.set(name, body);
      }
      if (!refConfig && !isNullOrEmpty(findUiRef)) {
        const name = `${cmdHead}-ref`;
        const body = findUiRef.replace(/\b(find-ui-ref)\b/g, name)
          .replace(/\b(_?find_ui_ref)\b/g, '_' + name.replace(/-/g, '_'))
          .replace(/\s+-f\s+"(.+?)"/, fileFilter);
        cmdAliasMap.set(name, body);
      }
    });
  }

  function getCommandAlias(cmdName: string, body: string, useFunction: boolean): string {
    let text = getCommandAliasText(cmdName, body, useFunction, terminalType, writeToEachFile);

    // Workaround for find-def + find-xxx-def
    const hotFixFindDefRegex = /^find(-[\w-]+)?-def$/;
    if (cmdName.match(hotFixFindDefRegex)) {
      text = text.replace('[a-z0-9]+(\\.|->|::)?[A-Z]', '[a-z0-9]+(\\.|->|::)[A-Z]');
    }

    cmdAliasMap.set(cmdName, text);
    return text;
  }
}

function getCommandAliasText(
  cmdName: string,
  cmdBody: string,
  useFunction: boolean,
  terminalType: TerminalType,
  writeToEachFile: boolean,
  addTailArgs: boolean = true,
  hideCmdAddColor: boolean = true,
  isPowerShellScript: boolean = false): string {
  if (hideCmdAddColor) {
    cmdBody = enableColorAndHideCommandLine(cmdBody);
  }

  const isWindowsTerminal = isWindowsTerminalOnWindows(terminalType);
  const hasSearchTextHolder = isWindowsTerminal ? /%~?1/.test(cmdBody) : /\$1|%~?1/.test(cmdBody);
  if (hasSearchTextHolder) {
    cmdBody = replaceSearchTextHolder(cmdBody.trimRight(), '$1');
  }

  let tailArgs = "";
  if (addTailArgs) {
    if (hasSearchTextHolder) {
      if (isPowerShellScript) { // only for find-spring-ref
        tailArgs = isWindowsTerminal
          ? ' $2 $3 $4 $5 $6 $7 $8 $9'
          //: ' $2 $3 $4 $5 $6 $7 $8 $9'.replace(/\$(\d+)/g, "'\\$$$1'"); // good
          : " '\\${@:2}'";
      }
      // For Windows must be: ' $2 $3 $4 $5 $6 $7 $8 $9', but msr can ignore duplicate $1, so this tricky way works fine, and avoid truncating long args.
      else {
        tailArgs = isWindowsTerminal ? ' $*' : ' "${@:2}"';
      }
    } else {
      tailArgs = isWindowsTerminal ? ' $*' : ' "$@"';
    }
  }

  return getCommandTextByNameAndBody(cmdName, cmdBody, tailArgs, useFunction, terminalType, writeToEachFile, isPowerShellScript);
}

function getCommandTextByNameAndBody(cmdName: string, cmdBody: string, tailArgs: string, useFunction: boolean, terminalType: TerminalType, writeToEachFile: boolean, isPowerShellScript: boolean = false) {
  const powerShellCmdText = getPowerShellName(terminalType) + ' -Command "' + cmdBody + tailArgs + '"';
  if (isWindowsTerminalOnWindows(terminalType)) {
    if (writeToEachFile) {
      return isPowerShellScript
        ? powerShellCmdText
        : replaceArgForWindowsCmdAlias('@' + cmdBody + tailArgs);
    }

    return isPowerShellScript
      ? cmdName + '=' + powerShellCmdText
      : cmdName + '=' + cmdBody + tailArgs;
  }

  const funBody = isPowerShellScript ? powerShellCmdText : cmdBody + tailArgs;
  if (useFunction) {
    const functionName = '_' + cmdName.replace(/-/g, '_');
    if (writeToEachFile) {
      return funBody;
    }

    return 'alias ' + cmdName + "='function " + functionName + '() {'
      + '\n\t' + funBody
      + '\n' + '}; ' + functionName + "'";
  }

  if (writeToEachFile) {
    return funBody;
  }
  return 'alias ' + cmdName + "='" + funBody + "'";
}

function outputCmdAliasGuide(cmdAliasFile: string, singleScriptFolder: string = '') {
  if (singleScriptFolder.length > 0) {
    outputInfoQuietByTime('Add folder ' + singleScriptFolder + ' to PATH then you can directly call the script name everywhere in/out vscode to search/replace like:');
  } else {
    outputInfoQuietByTime('Now you can directly use the command shortcuts in/out-of vscode to search + replace like:');
  }

  outputInfoQuiet('find-ndp dir1,dir2,file1,fileN -t MySearchRegex -x AndPlainText');
  outputInfoQuiet('find-nd -t MySearchRegex -x AndPlainText');
  outputInfoQuiet('find-code -it MySearchRegex -x AndPlainText');
  outputInfoQuiet('find-small -it MySearchRegex -U 5 -D 5 : Show up/down lines.');
  outputInfoQuiet('find-doc -it MySearchRegex -x AndPlainText -l -PAC : Show pure path list.');
  outputInfoQuiet('find-py-def ClassOrMethod -x AndPlainText : Search definition in python files.');
  outputInfoQuiet('find-py-ref MySearchRegex -x AndPlainText : Search references in python files.');
  outputInfoQuiet('find-ref "class\\s+MyClass" -x AndPlainText --np "unit|test" --xp src\\ext,src\\common -c show command line.');
  outputInfoQuiet('find-def MyClass -x AndPlainText --np "unit|test" --xp src\\ext,src\\common -c show command line.');
  outputInfoQuiet('find-ref MyClass --pp "unit|test" -U 3 -D 3 -H 20 -T 10 :  Preview Up/Down lines + Set Head/Tail lines in test.');
  outputInfoQuiet('find-ref OldClassOrMethod -o NewName -j : Just preview changes only.');
  outputInfoQuiet('find-ref OldClassOrMethod -o NewName -R : Replace files.');
  outputInfoQuiet('alias find-pure-ref');
  outputInfoQuiet('malias find -x all -H 9');
  outputInfoQuiet('malias "find[\\w-]*ref"');
  outputInfoQuiet('malias ".*?(find-\\S+)=.*" -o "\\2"  :  To see all find-xxx alias/doskeys.');
  outputInfoQuiet("malias use-rp :  To see matched alias/doskeys like 'use-rp', 'out-rp', 'use-fp' and 'out-fp' etc.");
  outputInfoQuiet('use-rp  - Search relative path(.) as input path: Output relative paths if no -W.');
  outputInfoQuiet('use-fp  - Search workspace root paths: Output absolute/full paths (regardless of -W).');
  outputInfoQuiet('out-rp  - Output relative path. This will not effect if use-fp which input full paths of current workspace.');
  outputInfoQuiet('out-fp  - Output full path.');
  outputInfoQuiet('Add -W to output full path; -I to suppress warnings; -o to replace text, -j to preview changes, -R to replace files.');
  outputInfoQuiet('You can also create your own command shortcuts in the file: ' + cmdAliasFile);
  outputInfoQuiet("Every time after changes, auto effect for new console/terminal. Run `update-alias` to update current terminal immediately.");
  outputInfoQuiet('See + Use command alias(shortcut) in `MSR-RUN-CMD` on `TERMINAL` tab, or start using in a new command window outside.');
  outputInfoQuiet('(if running `find-xxx` in vscode terminals, you can `click` the search results to open in vscode.)');
}

function addFullPathHideWarningOption(extraOption: string, writeToEachFile: boolean): string {
  const hasFoundOutputFullPath = /(^|\s+)-[PACIGMOZc]*?W/.test(extraOption);
  const isFullByConfig = writeToEachFile ? MyConfig.OutputFullPathWhenCookAndDumpingAliasFiles : MyConfig.OutputFullPathWhenCookingCommandAlias;
  const shouldOutputFullPath = isFullByConfig && (!isLinuxTerminalOnWindows() || !MyConfig.OutputRelativePathForLinuxTerminalsOnWindows);
  if (!hasFoundOutputFullPath && shouldOutputFullPath) {
    extraOption = '-W ' + extraOption.trimLeft();
  } else if (hasFoundOutputFullPath && !shouldOutputFullPath) {
    extraOption = extraOption.replace(/ -W /, ' ');
  }

  const hasFoundNoExtraInfo = /(^|\s+)-[PACWGMOZc]*?I/.test(extraOption);
  if (!hasFoundNoExtraInfo && MyConfig.HideWarningsAndExtraInfoWhenCookingCommandAlias) {
    extraOption = '-I ' + extraOption.trimLeft();
  } else if (hasFoundNoExtraInfo && !MyConfig.HideWarningsAndExtraInfoWhenCookingCommandAlias) {
    extraOption = extraOption.replace(/ -I /, ' ');
  }

  extraOption = setOutputColumnIndexInCommandLine(extraOption);
  return extraOption.trim();
}

function getExistingCmdAlias(terminalType: TerminalType, forMultipleFiles: boolean): Map<string, string> {
  var map = new Map<string, string>();
  const isWindowsTerminal = isWindowsTerminalOnWindows(terminalType);
  const defaultCmdAliasFile = getGeneralCmdAliasFilePath(terminalType);
  const defaultCmdAliasFileForDisplay = toTerminalPath(defaultCmdAliasFile, terminalType);
  const cmdAliasText = readTextFile(defaultCmdAliasFile);
  if (isNullOrEmpty(cmdAliasText)) {
    outputWarnByTime(`Not found or read empty file: ${defaultCmdAliasFileForDisplay}`);
    return map;
  }
  return getCmdAliasMapFromText(cmdAliasText, map, forMultipleFiles, isWindowsTerminal);
}

function getCmdAliasMapFromText(cmdAliasText: string, map: Map<string, string>, forMultipleFiles: boolean, isWindowsTerminal: boolean) {
  const lines = IsWindows ? cmdAliasText.split(/[\r\n]+/) : cmdAliasText.split(/(^|[\r\n])alias\s+/);
  const reg = /^(\w+[\w\.-]+)=(.+)/s;
  lines.forEach(a => {
    const match = reg.exec(a);
    if (match) {
      const body = forMultipleFiles
        ? (isWindowsTerminal
          ? replaceArgForWindowsCmdAlias(match[2])
          : replaceArgForLinuxCmdAlias(match[0])
        )
        : (isWindowsTerminal ? '' : 'alias ') + match[0].trim();
      map.set(match[1], body);
    }
  });

  return map;
}

function replaceArgForLinuxCmdAlias(body: string): string {
  // function or simple alias
  const functionBody = body.replace(/^\s*\S+=['"]\s*function\s+[^\r\n]+[\r\n]+\s*(.+?)\}\s*;\s*\S+\s*['"]\s*$/s, '$1');
  if (functionBody !== body) {
    return functionBody.trim();
  }

  const aliasBody = body.replace(/^.*?=['"](.+)['"]\s*$/, '$1')
    .replace(/^\S+=/, '');
  return aliasBody.trim();
}

function replaceArgForWindowsCmdAlias(body: string): string {
  body = replaceTextByRegex(body, /([\"'])\$1/g, '$1%~1');
  body = replaceTextByRegex(body, /\$(\d+)/g, '%$1');
  body = replaceTextByRegex(body, /\$\*/g, '%*');
  return body.trim();
}

export function replaceForLoopVariableOnWindows(cmd: string): string {
  // Example: for /f "tokens=*" %a in ('xxx') do xxx %a
  // Should replace %a to %%a when writing each alias/doskey to a file.
  const GetForLoopRegex = /\bfor\s+\/f\s+("[^"]*?tokens=\s*(?<Token>\*|\d+[, \d]*)[^"]*?"\s+)?%(?<StartVariable>[a-z])\s+in\s+\(.*?\)\s*do\s+/i;
  const match = GetForLoopRegex.exec(cmd);
  if (!match || !match.groups) {
    return cmd;
  }

  let tokens = match.groups['Token'] ? match.groups['Token'].split(/,\s*/) : ['1'];
  if (tokens.length === 1 && tokens[0] === '*') {
    tokens = ['1'];
  }

  const startingVariableName = match.groups['StartVariable'];
  const isLowerCaseVariable = startingVariableName.toLowerCase() === startingVariableName;
  let beginCharCode = isLowerCaseVariable
    ? startingVariableName.toLowerCase().charCodeAt(0)
    : startingVariableName.toUpperCase().charCodeAt(0);

  let variableChars: string[] = [];
  tokens.forEach((numberText) => {
    const number = Number.parseInt(numberText.toString());
    const variableName = String.fromCharCode(beginCharCode + number - 1);
    variableChars.push(variableName);
  });

  for (let k = 0; k < variableChars.length; k++) {
    cmd = cmd.replace(new RegExp('%' + variableChars[k], 'g'), '%%' + variableChars[k]);
  }

  // next for loop
  const subText = cmd.substring(match.index + match[0].length);
  return cmd.substring(0, match.index + match[0].length) + replaceForLoopVariableOnWindows(subText);
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

