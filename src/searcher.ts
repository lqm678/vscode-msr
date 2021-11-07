import { exec, ExecException, ExecOptions } from 'child_process';
import * as vscode from 'vscode';
import { IsForwardingSlashSupportedOnWindows, setSearchDepthInCommandLine, setTimeoutInCommandLine, ToolChecker } from './checkTool';
import { runFindingCommandByCurrentWord } from './commands';
import { getConfigValueByRoot, getSubConfigValue } from './configUtils';
import { IsWindows, RemoveJumpRegex } from './constants';
import { FileExtensionToMappedExtensionMap, getConfig, getGitIgnore, getSearchPathOptions, MyConfig } from './dynamicConfig';
import { FindCommandType, FindType, ForceFindType, TerminalType } from './enums';
import { filterClassResults } from './filter/filterClassResults';
import { outputDebug, outputDebugOrInfo, outputError, outputInfo, outputInfoByDebugMode, outputResult, outputWarn, runCommandInTerminal, runRawCommandInTerminal } from './outputUtils';
import { Ranker } from './ranker';
import { escapeRegExp } from './regexUtils';
import { ResultType, ScoreTypeResult } from './ScoreTypeResult';
import { SearchChecker } from './searchChecker';
import { changeFindingCommandForLinuxTerminalOnWindows, DefaultTerminalType, getCurrentWordAndText, getDefaultRootFolder, getExtensionNoHeadDot, getRootFolder, getRootFolderName, getSearchPathInCommand, IsLinuxTerminalOnWindows, isNullOrEmpty, nowText, quotePaths, replaceSearchTextHolder, toPath } from './utils';
import ChildProcess = require('child_process');
import path = require('path');

const GetFileLineTextRegex = new RegExp('^(.+?):(\\d+):(.*)');

const RemoveCommandLineInfoRegex = / ; Directory = .*/;
const GetSummaryRegex = /^(?:Matched|Replaced) (\d+) /m;
const NotIgnorableError = 'Please check your command with directory';
const CheckMaxSearchDepthRegex = /\s+(-k\s*\d+|--max-depth\s+\d+)/;

// Use bytes/second should be more precise.
const ExpectedMinLinesPerSecond = 16 * 10000;
const ExpectedMaxTimeCostSecond = 3.0;
let SearchToCostSumMap = new Map<FindType, number>();
let SearchTimesMap = new Map<FindType, number>();

let HasAlreadyReRunSearch: boolean = false;
let CurrentSearchPidSet = new Set<number>();

export function setReRunMark(hasAlreadyReRun: boolean) {
  HasAlreadyReRunSearch = hasAlreadyReRun;
}

export function stopAllSearchers() {
  if (CurrentSearchPidSet.size < 1) {
    return;
  }

  const command = IsWindows
    ? 'taskkill /F /T ' + Array.from(CurrentSearchPidSet).map(a => '/PID ' + a).join(' ')
    : 'kill -9 ' + Array.from(CurrentSearchPidSet).join(' ');

  const message = CurrentSearchPidSet.size + ' processes by command: ' + command;
  outputInfoByDebugMode(nowText() + 'Will kill ' + message);
  try {
    ChildProcess.execSync(command);
  } catch (err) {
    outputDebug(nowText() + 'Failed to kill ' + message + ', error = ' + err);
  }

  CurrentSearchPidSet.clear();
}

const LinuxToolChecker = new ToolChecker(DefaultTerminalType, false);
if (IsLinuxTerminalOnWindows && TerminalType.CygwinBash === DefaultTerminalType) {
  LinuxToolChecker.checkSearchToolExists();
}

export const PlatformToolChecker = new ToolChecker(IsWindows ? TerminalType.CMD : TerminalType.LinuxBash);
if (PlatformToolChecker.checkSearchToolExists()) {
  // avoid prompting 'cmd.exe exit error'
  const shouldActivate = !MyConfig.UseGitIgnoreFile || isNullOrEmpty(getDefaultRootFolder());// || !getGitIgnore(getDefaultRootFolder()).Valid;
  if (shouldActivate) {
    // to ease running command later (like: using git-ignore to export/set variables)
    runRawCommandInTerminal('echo TerminalType = ' + TerminalType[DefaultTerminalType] + ', Universal slash = ' + IsForwardingSlashSupportedOnWindows);
  }
}

PlatformToolChecker.checkAndDownloadTool('nin');

const RunCommandChecker = TerminalType.CygwinBash === DefaultTerminalType ? LinuxToolChecker : PlatformToolChecker;

export class Searcher {
  public Name: string;
  public SourcePath: string = '';
  public CommandLine: string;
  public Ranker: Ranker;
  public Process: ChildProcess.ChildProcess | null = null;
  public IsCompleted: boolean = false;

  private MaxSearchDepth: number;
  private FindType: FindType;

  constructor(findType: FindType, name: string, sourcePath: string, maxSearchDepth: number, commandLine: string, ranker: Ranker, timeoutSeconds: number) {
    this.FindType = findType;
    this.Name = name;
    this.SourcePath = sourcePath;
    this.MaxSearchDepth = maxSearchDepth;
    this.Ranker = ranker;
    this.CommandLine = setSearchDepthInCommandLine(commandLine, this.MaxSearchDepth);
    this.CommandLine = setTimeoutInCommandLine(this.CommandLine, timeoutSeconds);
  }

  public toString() {
    let text = 'Name = ' + this.Name;
    if (this.Process) {
      text += ', pid = ' + this.Process.pid;
    }
    return text + ', SourcePath = ' + this.SourcePath + ', Command = ' + this.CommandLine;
  }

  public searchMatchedWords(token: vscode.CancellationToken)
    : Thenable<vscode.Location[]> {
    try {
      outputInfo('\n' + nowText() + this.CommandLine + '\n');
      return getMatchedLocationsAsync(this.FindType, this.CommandLine, this.Ranker, token, this);
    } catch (error) {
      if (error instanceof Error && error.stack) {
        outputError(nowText() + error.stack);
      }

      outputError(nowText() + error);
      return Promise.resolve([]);
    }
  }

  public stop() {
    if (!this.IsCompleted) {
      killProcess(this.Process, this.toString());
    }
  }
}

export function createSearcher(searchChecker: SearchChecker, name: string, sourcePath: string, recursive: boolean = true,
  forceFindType: ForceFindType = ForceFindType.None,
  maxSearchDepth: number = MyConfig.MaxSearchDepth,
  timeout: number = MyConfig.MaxWaitSecondsForSearchDefinition)
  : Searcher | null {
  outputDebug(nowText() + 'Will create ranker + command line for searcher: ' + name);
  const [commandLine, ranker] = getSearchCommandLineAndRanker(searchChecker, FindType.Definition, recursive, sourcePath, forceFindType);
  if (isNullOrEmpty(commandLine) || ranker === null) {
    return null;
  }

  return new Searcher(FindType.Definition, name, sourcePath, maxSearchDepth, commandLine, ranker, timeout);
}

export function createCommandSearcher(name: string, sourcePath: string, commandLine: string, ranker: Ranker,
  maxSearchDepth: number = MyConfig.MaxSearchDepth,
  timeout: number = MyConfig.MaxWaitSecondsForSearchDefinition)
  : Searcher {
  return new Searcher(FindType.Definition, name, sourcePath, maxSearchDepth, commandLine, ranker, timeout);
}

function getSearchCommandLineAndRanker(searchChecker: SearchChecker, findType: FindType, isRecursive: boolean,
  forceSetSearchPath: string = '', forceFindType: ForceFindType = ForceFindType.None)
  : [string, Ranker | null] {
  const document = searchChecker.Document;
  const position = searchChecker.Position;
  const [parsedFile, extension, currentWord, currentWordRange] = getCurrentFileSearchInfo(document, position);
  if (!PlatformToolChecker.checkSearchToolExists() || currentWord.length < 2 || !currentWordRange) {
    return ['', null];
  }

  const rootFolderName = getRootFolderName(document.uri.fsPath);

  const mappedExt = FileExtensionToMappedExtensionMap.get(extension) || extension;
  if (MyConfig.IsDebug) {
    outputDebug('mappedExt = ' + mappedExt + ' , languageId = ' + document.languageId + ' , file = ' + document.fileName);
  }

  const currentFilePath = toPath(parsedFile);
  const isSearchOneFile = forceSetSearchPath === currentFilePath;
  const isSearchOneFileOrFolder = isSearchOneFile || forceSetSearchPath === parsedFile.dir;
  let ranker = new Ranker(searchChecker, isSearchOneFileOrFolder, forceFindType);

  const configKeyName = FindType.Definition === findType ? 'definition' : 'reference';
  const [filePattern, searchOptions] = ranker.getFileNamePatternAndSearchOption(extension, configKeyName, parsedFile);
  if (filePattern.length < 1 || searchOptions.length < 1) {
    outputError(nowText() + 'Failed to get filePattern or searchOptions when search: ' + currentWord + ', filePattern = ' + filePattern + ', searchOptions = ' + searchOptions);
    return ['', null];
  }

  const isFindDefinition = FindType.Definition === findType;

  let extraOptions = '';
  if (isSearchOneFile) {
    extraOptions = "-I -C " + (isFindDefinition ? '-J -H 60' : '-J -H 360');
  } else {
    extraOptions = getSubConfigValue(rootFolderName, extension, mappedExt, configKeyName, 'extraOptions', true);
    // if (skipTestPathFiles && /test/i.test(document.fileName) === false && /\s+--np\s+/.test(extraOptions) === false) {
    // 	extraOptions = '--np test ' + extraOptions;
    // }
  }

  const useExtraPathsForDefinition = isNullOrEmpty(forceSetSearchPath)
    && getConfigValueByRoot(rootFolderName, extension, mappedExt, 'findDefinition.useExtraPaths') === "true";

  const useExtraPathsForReference = isNullOrEmpty(forceSetSearchPath)
    && getConfigValueByRoot(rootFolderName, extension, mappedExt, 'findReference.useExtraPaths') === "true";

  const useSkipFolders = forceSetSearchPath !== document.uri.fsPath;
  const usePathListFiles = isNullOrEmpty(forceSetSearchPath);

  const recursiveArg = isRecursive || isNullOrEmpty(forceSetSearchPath) ? '-rp ' : '-p ';
  const searchPathOptions = document.uri.fsPath === forceSetSearchPath
    ? recursiveArg + quotePaths(forceSetSearchPath)
    : getSearchPathOptions(false, true, document.uri.fsPath, mappedExt, isFindDefinition, useExtraPathsForReference, useExtraPathsForDefinition,
      useSkipFolders, usePathListFiles, forceSetSearchPath, isRecursive);

  let commandLine = 'msr ' + searchPathOptions;
  if (!isSearchOneFile) {
    commandLine += ' -f ' + filePattern;
  }

  if (isNullOrEmpty(forceSetSearchPath) && MyConfig.MaxSearchDepth > 0 && !CheckMaxSearchDepthRegex.test(commandLine)) {
    extraOptions = extraOptions.trimRight() + ' -k ' + MyConfig.MaxSearchDepth.toString();
  }

  if (FindType.Definition === findType) {
    commandLine += ' ' + searchOptions + ' ' + extraOptions.trim();
  } else {
    commandLine += ' ' + extraOptions + ' ' + searchOptions.trim();
  }

  commandLine = replaceSearchTextHolder(commandLine, currentWord).trim();
  return [commandLine, ranker];
}

export function getCurrentFileSearchInfo(document: vscode.TextDocument, position: vscode.Position, escapeTextForRegex: boolean = true): [path.ParsedPath, string, string, vscode.Range, string] {
  const parsedFile = path.parse(document.fileName);
  const extension = getExtensionNoHeadDot(parsedFile.ext);
  let [currentWord, currentWordRange, currentText] = getCurrentWordAndText(document, position);
  if (currentWord.length < 2 || !currentWordRange || !PlatformToolChecker.checkSearchToolExists()) {
    return [parsedFile, extension, '', new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), ''];
  }

  const isPowershell = /psm?1$/.exec(extension);
  if (isPowershell && currentText.indexOf('$' + currentWord) >= 0) {
    currentWord = '$' + currentWord;
  }

  const searchText = escapeTextForRegex ? escapeRegExp(currentWord) : currentWord;
  return [parsedFile, extension, searchText, currentWordRange, currentText];
}


export function getMatchedLocationsAsync(findType: FindType, cmd: string, ranker: Ranker, token: vscode.CancellationToken, searcher: Searcher | null = null): Thenable<vscode.Location[]> {
  const options: ExecOptions = {
    cwd: getRootFolder(toPath(ranker.searchChecker.currentFile), true) || ranker.searchChecker.currentFile.dir,
    env: process.env,
    // timeout: 60 * 1000,
    maxBuffer: 10240000,
  };

  return new Promise<vscode.Location[]>((resolve, _reject) => {
    const process = exec(cmd, options, (error: | ExecException | null, stdout: string, stderr: string) => {
      if (searcher) {
        searcher.IsCompleted = true;
        outputDebug(nowText() + 'Completed searcher: ' + searcher.toString());
      }

      if (error) {
        const hasSummary = GetSummaryRegex.test(error.message);
        if (error.message.includes(NotIgnorableError)) {
          outputError(nowText() + error.message);
        }
        if (hasSummary) {
          // console.info('False error message: ' + error.message);
        } else if (error.message.startsWith('Command fail')) {
          if (!error.message.trimRight().endsWith(cmd)) {
            // Check if previous searching not completed. Try again or wait.
            console.warn('Got error message: ' + error.message);
          }
        } else {
          console.warn(error.message); // outDebug(error.message);
        }
      }

      const allResults: vscode.Location[] = isNullOrEmpty(stdout) ? [] : parseCommandOutput(stdout, findType, cmd, ranker);

      if (stderr) {
        if (!findAndProcessSummary(allResults.length, false, stderr, findType, cmd, ranker)) {
          if (/\bmsr\b.*?\s+not\s+/.test(stderr)) {
            PlatformToolChecker.checkSearchToolExists(true, false);
          }
        }
      }

      if (allResults.length > 0) {
        stopAllSearchers();
      }

      resolve(allResults);
    });

    CurrentSearchPidSet.add(process.pid);
    if (searcher) {
      searcher.Process = process;
    }

    token.onCancellationRequested(() => killProcess(process, 'Canceled searcher ' + (searcher ? searcher.toString() : '')));
  });
}

function killProcess(process: ChildProcess.ChildProcess | null, extraInfo: string = '') {
  if (null === process) {
    return;
  }

  try {
    outputInfoByDebugMode(nowText() + 'Kill process ' + process.pid + ' ' + extraInfo.trimLeft());
    process.kill();
  } catch (err) {
    outputError(nowText() + 'Failed to kill process ' + process.pid + ' ' + extraInfo.trimLeft() + ', error = ' + err);
  }
}

function findAndProcessSummary(filteredResultCount: number, skipIfNotMatch: boolean, summaryText: string, findType: FindType, cmd: string, ranker: Ranker): boolean {
  const summaryMatch = GetSummaryRegex.exec(summaryText);
  if (!summaryMatch && skipIfNotMatch) {
    return false;
  }

  const matchErrorWarn = /(\s+|\d+m)(WARN|ERROR)\b/.exec(summaryText);
  if (matchErrorWarn) {
    const warnOrError = matchErrorWarn[2];
    if (warnOrError === 'WARN') {
      outputDebug('\n' + nowText() + summaryText.replace(/^([\r\n]+)/, 'WARN: '));
    } else {
      outputError('\n' + nowText() + summaryText.replace(/^([\r\n]+)/, 'ERROR: '));
    }
  }

  if (!summaryMatch) {
    return false;
  }

  const match = /^Matched (\d+) lines.*?read (\d+) lines.*?Used (\d+\.\d*) s/.exec(summaryText);
  const matchCount = match ? parseInt(match[1]) : 0;
  const outputSummary = '\n' + nowText() + (MyConfig.IsDebug ? summaryText : summaryText.replace(RemoveCommandLineInfoRegex, ''));
  outputDebugOrInfo(matchCount < 1, matchCount > 0 ? outputSummary : outputSummary.trim());

  if (match) {
    const lineCount = parseInt(match[2]);
    const costSeconds = parseFloat(match[3]);
    outputDebug(nowText() + 'Got matched count = ' + matchCount + ' and time cost = ' + costSeconds + ' from summary, search word = ' + ranker.searchChecker.currentWord);
    sumTimeCost(findType, costSeconds, lineCount);
    if (matchCount < 1 && MyConfig.RootConfig.get('enable.useGeneralFindingWhenNoResults') as boolean) {
      const findCmd = findType === FindType.Definition ? FindCommandType.RegexFindAsClassOrMethodDefinitionInCodeFiles : FindCommandType.RegexFindAsClassOrMethodDefinitionInCodeFiles;
      if (!HasAlreadyReRunSearch && !ranker.isOneFileOrFolder && ranker.canRunCommandInTerminalWhenNoResult) {
        HasAlreadyReRunSearch = true;
        const forceSearchPaths = getSearchPathInCommand(cmd);
        runFindingCommandByCurrentWord(findCmd, ranker.searchChecker.currentWord, ranker.searchChecker.currentFile, '', true, forceSearchPaths);
        outputInfo(nowText() + 'Will run general search, please check results in `MSR-RUN-CMD` in `TERMINAL` tab. Set `msr.quiet` to avoid switching tabs; Disable `msr.enable.useGeneralFindingWhenNoResults` to disable re-running.');
        outputInfo(nowText() + 'Try extensive search if still no results. Use context menu or: Click a word or select a text  --> Press `F12` --> Type `msr` + `find` and choose to search.');
      }
    }
    else if (!HasAlreadyReRunSearch && filteredResultCount > 1 && ranker.canRunCommandInTerminalWhenManyResults && matchCount > MyConfig.ReRunSearchInTerminalIfResultsMoreThan && costSeconds <= MyConfig.ReRunCmdInTerminalIfCostLessThan) {
      HasAlreadyReRunSearch = true;
      outputInfo(nowText() + 'Will re-run and show clickable + colorful results in `MSR-RUN-CMD` in `TERMINAL` tab. Set `msr.quiet` to avoid switching tabs; Decrease `msr.reRunSearchInTerminalIfCostLessThan` value for re-running.');
      cmd = changeFindingCommandForLinuxTerminalOnWindows(cmd);
      const gitIgnore = getGitIgnore(ranker.searchChecker.currentFilePath);
      cmd = gitIgnore.replaceToSkipPathVariable(cmd);
      cmd = RunCommandChecker.toRunnableToolPath(cmd);
      // cmd = cmd.replace(SkipJumpOutForHeadResultsRegex, ' ').trim();
      cmd = cmd.replace(RemoveJumpRegex, ' ').trim();
      runCommandInTerminal(cmd, false, getConfig().ClearTerminalBeforeExecutingCommands);
    }
  } else if (!ranker.isOneFileOrFolder) {
    outputDebug(nowText() + 'Failed to get time cost in summary. Search word = ' + ranker.searchChecker.currentWord);
  }

  return true;
}

function sumTimeCost(findType: FindType, costSeconds: number, lineCount: number) {
  const times = 1 + (SearchTimesMap.get(findType) || 0).valueOf();
  SearchTimesMap.set(findType, times);

  const costSum = costSeconds.valueOf() + (SearchToCostSumMap.get(findType) || 0).valueOf();
  SearchToCostSumMap.set(findType, times === 1 ? Math.min(3, costSum) : costSum);

  const speed = lineCount.valueOf() / costSeconds.valueOf();
  const average = costSum / times;
  const message = 'Search-' + FindType[findType] + ' cost ' + costSeconds.toFixed(3) + ' s for ' + lineCount + ' lines, speed = ' + Math.round(speed) + ' lines/s.';

  if (times > 3 && average > ExpectedMaxTimeCostSecond && speed < ExpectedMinLinesPerSecond) {
    outputWarn(nowText() + message + ' If CPU and disk are not busy, try to be faster: https://github.com/qualiu/vscode-msr/blob/master/README.md#avoid-security-software-downgrade-search-performance');
  } else {
    outputDebug(nowText() + message);
  }
}

function parseCommandOutput(stdout: string, findType: FindType, cmd: string, ranker: Ranker): vscode.Location[] {
  let matchedFileLines = stdout.trimRight().split(/\r\n|\n\r|\n|\r/);
  const summaryText = matchedFileLines.length > 0 && GetSummaryRegex.test(matchedFileLines[matchedFileLines.length - 1]) ? matchedFileLines[matchedFileLines.length - 1] : '';
  if (summaryText.length > 0) {
    matchedFileLines.pop();
  }

  if (ranker.isOneFileOrFolder && matchedFileLines.length > 0) {
    outputInfo('');
  }

  let allResults: vscode.Location[] = [];
  if (!MyConfig.NeedSortResults || matchedFileLines.length < 2) {
    matchedFileLines.map(line => {
      const scoreTypeResult = parseMatchedText(line, ranker);
      if (scoreTypeResult) {
        allResults.push(scoreTypeResult.Location);
        let sc = scoreTypeResult.Location.range.start;
        let fileRowColumn = line.replace(':' + (sc.line + 1) + ':', ':' + (sc.line + 1) + ':' + sc.character);
        outputResult(fileRowColumn);
      } else {
        outputResult(line);
      }
    });

    if (summaryText.length > 0) {
      findAndProcessSummary(allResults.length, true, summaryText, findType, cmd, ranker);
    }

    return allResults;
  }

  const rootFolderName = getRootFolderName(toPath(ranker.searchChecker.currentFile));
  const removeLowScoreResultsFactor = Number(getConfigValueByRoot(rootFolderName, ranker.searchChecker.extension, ranker.searchChecker.mappedExt, 'removeLowScoreResultsFactor') || 0.8);
  const keepHighScoreResultCount = Number(getConfigValueByRoot(rootFolderName, ranker.searchChecker.extension, ranker.searchChecker.mappedExt, 'keepHighScoreResultCount') || -1);

  let scoreSum = 0;
  let scoreList: number[] = [];
  let scoreToListMap = new Map<number, [string, vscode.Location][]>();
  let typeToResultsMap = new Map<ResultType, ScoreTypeResult[]>();
  matchedFileLines.map(line => {
    const scoreTypeResult = parseMatchedText(line, ranker);
    if (!scoreTypeResult) {
      return;
    }

    let resultList = typeToResultsMap.get(scoreTypeResult.Type);
    if (!resultList) {
      resultList = [];
      typeToResultsMap.set(scoreTypeResult.Type, resultList);
    }
    resultList.push(scoreTypeResult);
  });

  typeToResultsMap.forEach((v, type) => {
    outputDebug(nowText() + ResultType[type] + ' count = ' + v.length + ', search word = ' + ranker.searchChecker.currentWord);
  });

  if (ranker.searchChecker.isFindMember && typeToResultsMap.has(ResultType.Member)) {
    [ResultType.Class, ResultType.Interface, ResultType.Enum].forEach(
      a => typeToResultsMap.delete(a)
    );
  }

  let highValueResults = [...typeToResultsMap.get(ResultType.Class) || [], ...typeToResultsMap.get(ResultType.Enum) || []];
  [ResultType.Interface, ResultType.Method, ResultType.ConstantValue, ResultType.Member, ResultType.LocalVariable, ResultType.None].forEach(
    (type) => {
      if (highValueResults.length < 1) {
        highValueResults = typeToResultsMap.get(type) || [];
      }
    });

  highValueResults = filterClassResults(highValueResults, ranker.searchChecker);
  highValueResults.forEach((value) => {
    const score = value.Score;
    const location = value.Location;
    scoreSum += score.valueOf();
    scoreList.push(score);

    if (!scoreToListMap.has(score)) {
      scoreToListMap.set(score, []);
    }

    if (location) {
      let sc = location.range.start;
      let fileRowColumn = value.ResultText.replace(':' + (sc.line + 1) + ':', ':' + (sc.line + 1) + ':' + sc.character);
      (scoreToListMap.get(score) || []).push([fileRowColumn, location]);
    }
  });

  scoreList.sort((a, b) => a.valueOf() - b.valueOf());
  const maxScore: number = scoreList.length < 1 ? -1 : scoreList[scoreList.length - 1];
  const averageScore = scoreSum / Math.max(1, scoreList.length);
  const removeThreshold = ranker.isOneFileOrFolder && findType === FindType.Definition ? averageScore : maxScore * removeLowScoreResultsFactor;

  const isDescending = MyConfig.DescendingSortForVSCode;
  const sortedMap = isDescending
    ? [...scoreToListMap.entries()].sort((a, b) => b[0].valueOf() - a[0].valueOf())
    : [...scoreToListMap.entries()].sort((a, b) => a[0].valueOf() - b[0].valueOf());

  let outputList: string[] = [];
  let debugList: string[] = [];
  let removedCount = 0;
  const beginAddNumber = keepHighScoreResultCount < 1 ? 0 : (isDescending ? 0 : scoreList.length - keepHighScoreResultCount + 1);
  const endAddNumber = keepHighScoreResultCount < 1 ? scoreList.length : (isDescending ? keepHighScoreResultCount : scoreList.length);
  let eleNumber = 0;
  sortedMap.forEach(list => {
    const currentScore = list[0];
    list[1].forEach(a => {
      eleNumber++;
      if ((isDescending && eleNumber > endAddNumber) || (!isDescending && eleNumber < beginAddNumber)) {
        console.log('Remove non-keep results[' + eleNumber + ']: Score = ' + currentScore + ' : ' + a[0]);
        removedCount++;
        return;
      }

      if (currentScore < removeThreshold && findType === FindType.Definition) {
        removedCount++;
        console.log('Remove low score results[' + eleNumber + ']: Score = ' + currentScore + ' : ' + a[0]);
        return;
      }

      debugList.push('Score = ' + currentScore + ' : ' + a[0]);
      if (MyConfig.DescendingSortForConsoleOutput === MyConfig.DescendingSortForVSCode) {
        outputResult(a[0]);
      } else {
        outputList.push(a[0]);
      }
      allResults.push(a[1]);
    });
  });

  for (let k = outputList.length - 1; k >= 0; k--) {
    outputResult(outputList[k]);
  }

  for (let k = isDescending ? debugList.length - 1 : 0; isDescending ? k >= 0 : k < debugList.length; isDescending ? k-- : k++) {
    console.log(debugList[k]);
  }

  const minScore = scoreList.length < 1 ? -1 : scoreList[0];
  console.log(nowText() + 'Result-Count = ' + scoreList.length + ' , averageScore = ' + averageScore.toFixed(1)
    + ' , max = ' + maxScore.toFixed(1) + ' , min = ' + minScore.toFixed(1)
    + (maxScore.valueOf() === 0 ? '' : ' , min/max = ' + (minScore.valueOf() / maxScore.valueOf()).toFixed(2))
    + ' , removeFactor = ' + removeLowScoreResultsFactor + ' , threshold = ' + removeThreshold.toFixed(1)
    + ' , removedCount = ' + removedCount + ' , scoreWordsText = ' + ranker.scoreWordsText);

  if (summaryText.length > 0) {
    findAndProcessSummary(scoreList.length, true, summaryText, findType, cmd, ranker);
  }

  return allResults;
}

function parseMatchedText(text: string, ranker: Ranker): ScoreTypeResult | null {
  let m;
  if ((m = GetFileLineTextRegex.exec(text)) !== null) {
    const uri = vscode.Uri.file(m[1]);
    const wm = ranker.searchChecker.currentWordRegex.exec(m[3]);
    if (wm !== null) {
      const row = parseInt(m[2]);
      const begin = new vscode.Position(row - 1, Math.max(0, wm.index - 1));
      // some official extension may return whole function block.
      // const end = new vscode.Position(row - 1, wm.index - 1 + ranker.currentWord.length - 1);
      const [type, score] = MyConfig.NeedSortResults ? ranker.getTypeAndScore(begin, m[1], m[3]) : [ResultType.None, 1];
      if (!MyConfig.NeedSortResults) {
        console.log('Score = ' + score + ': ' + text);
      }

      return 0 === score ? null : new ScoreTypeResult(score, type, text, new vscode.Location(uri, begin));
    }
    else {
      outputError(nowText() + 'Failed to match words by Regex = "' + ranker.searchChecker.currentWordRegex + '" from matched result: ' + m[3]);
    }
  }
  else {
    outputError(nowText() + 'Failed to match GetFileLineTextRegex = "' + GetFileLineTextRegex.source + '" from matched result: ' + text);
  }

  return null;
}
