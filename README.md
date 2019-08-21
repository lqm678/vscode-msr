# vscode-msr

Have you suffered issues of finding `definitions` and `references`:

- **Unable to `jump-to-definition` or `find-references`** if `IDE has problems` or `build failed` or `lack of packages` ?
- **Unable to coding in IDE for one entire repository** due to `multiple languages` (`C#` , `C++` , `Java`/`Scala`, `Python`, `Vue`, etc.) ?
- **Unable to coding in IDE for multiple related repositories** in multiple root folders ?
- **Missed updates to some types of files** when performed changes like `rename`, `refactor`, `update-versions`, etc.
- **Quite slow to take a full search** but have to do it and wait ?
  
Then it's the [**light** and **right** tool](https://github.com/qualiu/vscode-msr) for you (Take **less than 1 minute** for better experience and [help you more](#more-freely-to-use-and-help-you-more)).

Note: Support **64-bit** + **32-bit** : **Windows** + **Linux** (`Ubuntu` / `CentOS` / `Fedora` which `gcc`/`g++` version >= `4.8`).
  
## Features

- Got search results in **1~3 seconds** for 20000+ code files (on hard-drives, **SSD** maybe faster) after first time (cost 10~30+ seconds).

- Fast find **definitions** + **references** for **all types** of coding languages files, across **multiple related repositories** on local.

- Also can find **definitions** + **references** from **any type of files** + **any type** (like text `in comments` or `just typed`).

- Simple + flexible configuration (`just general Regex` of `C++`,`Java`,`C#`,`Python`), overwrite default settings if need.

- [Normal + Extensive Search](#normal-and-extensive-search) knows and serves your better.

- Easy + Fast to **reuse** the command line of [msr.EXE](https://github.com/qualiu/msr/blob/master/README.md) to [**Search Further** or **Replace Files**](#reuse-the-command-to-search-further-or-replace-files).

- [Every function is **under your control**](#every-function-is-under-your-control-and-easy-to-change) and easy to enable or disable.
  
- Just leverage [one tiny exe: msr-EXE](https://github.com/qualiu/msr/blob/master/README.md) **without** `storage`/`cache`, `server`/`service`, `network`, etc.
  - This extension costs **2~3 MB** download/storage + **3~10 MB** running memory.
  - Others may cost **X GB** storage for dependencies/packages + **Y GB** running memory + even **requires building**.

[Screenshot GIF](https://raw.githubusercontent.com/qualiu/vscode-msr/master/images/find-def-ref.gif): Search **Definitions** + **References** for **C++** / **Python** / **Java** in `Visual Studio Code`:

<img src=https://raw.githubusercontent.com/qualiu/vscode-msr/master/images/find-def-ref.gif width=956 height=480>

More powerfull usages + examples see [overview doc](https://github.com/qualiu/msr/blob/master/README.md) or just run [msr-EXE](https://qualiu.github.io/msr/usage-by-running/msr-Windows.html) you will see [colorful text doc of usage + examples](https://qualiu.github.io/msr/usage-by-running/msr-Windows.html) (on Windows, [Linux at here](https://qualiu.github.io/msr/usage-by-running/msr-CentOS-7.html)) or [doc without color](https://raw.githubusercontent.com/qualiu/msr/master/tools/readme.txt).

## More Freely to Use and Help You More

Add [msr.EXE](https://github.com/qualiu/msr/tree/master/tools) folder to `%PATH%` (Windows) or `$PATH`(Linux) to more freely to help your [daily file processing + data mining](https://github.com/qualiu/msr/blob/master/README.md).

As default, if not found [msr.EXE](https://github.com/qualiu/msr/blob/master/README.md) in `%PATH%`/`$PATH`, it'll auto download to `~/msr` (on **Linux**) or `%USERPROFILE%\Desktop\msr.exe` (on **Windows**).

You can also manually **download** the tiny [msr.EXE](https://github.com/qualiu/msr/tree/master/tools) (of your system type) , then **add** the folder to `%PATH%` or `$PATH`.

Suggest you use/create a tool folder like `~/tools` or `D:\tools` instead of `system folder` for 1 command line below:

- **Windows**：Download + copy to a folder like `%SystemRoot%` (Use **[msr-Win32.exe](https://github.com/qualiu/msr/raw/master/tools/msr-Win32.exe)** for 32-bit system)

     **Powershell** `-Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/qualiu/msr/blob/master/tools/msr.exe?raw=true' -OutFile msr.exe"` && **copy** [msr.exe](https://github.com/qualiu/msr/raw/master/tools/msr.exe) `%SystemRoot%\`
  
- **Cygwin**: copy or make a link (`ln -s msr.cygwin /usr/bin/msr`)

     **wget** <https://github.com/qualiu/msr/raw/master/tools/msr.cygwin> && `chmod +x msr.cygwin` && `cp msr.cygwin /usr/bin/msr`
  
- **Linux**: `Ubuntu`,`CentOS`,`Fedora`: (gcc/g++ >= 4.8; Use **[msr-i386.gcc48](https://github.com/qualiu/msr/raw/master/tools/msr-i386.gcc48)** for 32-bit system)

    **wget** <https://github.com/qualiu/msr/raw/master/tools/msr.gcc48> && `chmod +x msr.gcc48` && `cp msr.gcc48 /usr/bin/msr`

After done, you can directly run **msr --help** (or **msr -h** or just **msr**) should display [colorful usages and examples on Windows](https://qualiu.github.io/msr/usage-by-running/msr-Windows.html) or Linux like: [Fedora](https://qualiu.github.io/msr/usage-by-running/msr-Fedora-25.html) and [CentOS](https://qualiu.github.io/msr/usage-by-running/msr-CentOS-7.html).

## Avoid Security Software Downgrade Search Performance

If you cannot get search results **in 1~2 seconds** for just **10000 code files** (will auto skip other types like `packages`, `build` and `junk files`):

Add an exclusion to avoid performance impact from the system security software, just like the impacts to `node.exe` , `pip.exe` and `python.exe` etc.

For example on **Windows** see official doc: [Add an exclusion to Windows Security](https://support.microsoft.com/en-us/help/4028485/windows-10-add-an-exclusion-to-windows-security).

Add **Process** type (name) + **File** type (path) exclusions for [msr.EXE](https://github.com/qualiu/msr/tree/master/tools).

<img align='center' src=https://raw.githubusercontent.com/qualiu/vscode-msr/master/images/add-exclusion-on-windows.png width=798 height=489>

## Every Function is Under Your Control and Easy to Change

## Hide or Show More Context Menus

To show or hide more menus, [open user settings](https://code.visualstudio.com/docs/getstarted/settings#_creating-user-and-workspace-settings) check/un-check menus like [screenshot](https://raw.githubusercontent.com/qualiu/vscode-msr/master/images/editor-context-menu.png) below:

<img align='center' src=https://raw.githubusercontent.com/qualiu/vscode-msr/master/images/editor-context-menu.png width=711 height=269>

Provided 20 `Plain-text find` + `Regex find` + `Sort` context menu items, but just show a few of them by default settings.

Set `msr.menu.visible` = `false` to hide all context menus of `Regex find xxx` + `Find xxx` etc.

### Disable Finding for Specific File Types

- `msr.disable.extensionPattern`

  Regex pattern of **file name extensions** to **disable** `find definition and references`.
  
  For example: Set `\.(cs|java|scala)$` to disable for `C#` and `Java`/`Scala` files.

### Disable Finding for Specific Projects By Root Folder Name

- `msr.disable.projectRootFolderNamePattern`  (**case sensitive**)

  Regex pattern of `git root folder name` to **disable** `find definition and references` functions for specific projects.

  For example: `^(Project\d+)$` to disable for D:\\**Project1** and C:\git\\**Project2**.

### Disable Finding Definition or References for All

- `msr.enable.definition`: Set to `false` or un-check it to **disable** `find definitions` function for all types of files.
- `msr.enable.reference`: Set to `false` or un-check it to **disable** `find references` function for all types of files.

## Extension Settings If You Want to Change

You **don't need to change settings** from [configuration file](https://github.com/qualiu/vscode-msr/blob/master/package.json) unless you want to tune or improve `Regex` patterns, or add **extra search paths** , etc.

Note: Check [**your personal settings**](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations) (`msr.xxx` in file) with the latest tuned github settings, especially for `Regex`  patterns.

### General/Default Settings Examples

- `msr.default.maxSearchDepth`: Set `max search depth` when finding definitions or references.
- `msr.default.codeFiles`: Set `default` Regex pattern for `source code files`.
- `msr.descendingSortForVSCode`: Descending sort search results for `vscode`.
- `msr.descendingSortForConsoleOutput`: Descending sort search results for output channel in `vscode` bottom.
- `msr.default.skipFolders`: Set `default`/`common` skip folders Regex pattern.
- `msr.default.removeLowScoreResultsFactor`: Default threshold = `0.8` (of max score) to remove low score results.
- `msr.default.keepHighScoreResultCount`: Default count = -1 (keep all) to keep top high score results.
  
### Additional Settings in [Your Personal Settings file](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations)

- Set `skipFolders` for Specific Project
  
  You can set `skipFolders` pattern for each project to **overwrite** `default.skipFolders` in [your personal settings file](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations).
  
  Like adding `msr.{root-folder-name}.skipFolders` + value in `%APPDATA%\Code\User\settings.json` on Windows:

  ```json
  "msr.My-Project-Root-Folder-Name.skipFolders": "^(uint|tests)$|other-partial-folder-name"
  ```

- Promote Scores for Specific Project Folders or Paths
  
  Set below items if you need in [your personal settings file](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations) like `%APPDATA%\Code\User\settings.json` on Windows.

  Regex pattern to promote scores for sorting definition (`Go To Definition`) or references (`Find All References`):
  - `msr.{root-folder-name}.promoteFolderPattern`: Regex pattern to promte folder scores for result file folders.
  - `msr.{root-folder-name}.promotePathPattern`: Regex pattern to promte path scores for result file paths.
  - `msr.{root-folder-name}.promoteFolderScore`: Recommended value is 100 to 1000. Default = 200 if not set.
  - `msr.{root-folder-name}.promotePathScore`:  Recommended value is 100 to 1000. Default = 200 if not set.

### Extra Paths Settings

- `msr.default.extraSearchPaths`: **Extra search paths** of external repositories, dependency sources, or libraries, etc.
- `msr.default.extraSearchPathListFiles`: **Read extra search path list files** of external repositories, dependency sources, or libraries, etc.

These global **extra search paths** settings enable searching related files **without loading** them into `Visual Studio Code`.

### Specific Extra Search Paths Settings

If you want to set extra search paths for **a specific project**, use below format to set extra `paths` or `path-list-files`:

- Value format:  `[Global-Paths]`; `[Project1-Folder-Name = Path1, Path2, Path3]`;  `[Project2-Folder-Name=Path5,Path6]`;
- Use **semicolon** '**;**' to separate `groups`. A `[group]` is either `global-paths` or a `name=paths` pair.
- Use **comma** '**,**' to separate paths in a `[group]`.
- You can omit `global-paths` or `name=paths` pairs. Just set what you want, like one or more paths (global).

**For example**, if you have 2 projects: `d:\git\`**project1** + `d:\git\`**project2** + a common/global path = `D:\myLibs\boost`

You can set values for the projects like below, and their `extra search paths` will be below:

- `msr.default.extraSearchPaths`
  - Set value like: `D:\myLibs\boost;  project1 = D:\git\baseLib,D:\git\teamLib;  project2=d:\git\project1;`
  - Then paths will be:
    - **project1** extra search paths = `D:\myLibs\boost,D:\git\baseLib,D:\git\teamLib`
    - **project2** extra search paths = `D:\myLibs\boost,d:\git\project1`
- `msr.default.extraSearchPathListFiles`
  - Set value like: `project1=d:\paths1.txt,D:\paths2.txt;   project2 = d:\paths3.txt`
  - Then paths will be:
    - **project1** extra search path list files = `d:\paths1.txt,D:\paths2.txt`
    - **project2** extra search path list files = `d:\paths3.txt`

**Since 1.0.7** : Much easier to set in [your personal settings file](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations) like `%APPDATA%\Code\User\settings.json` on Windows:

- `msr.project1.extraSearchPaths` : `"D:\myLibs\boost,D:\git\baseLib,D:\git\teamLib"`
- `msr.project2.extraSearchPaths` : `"D:\myLibs\boost,d:\git\project1"`

- Same to `msr.xxx.extraSearchPathListFiles` settings.

- You can also use `msr.default.extraSearchPathGroups` + `msr.default.extraSearchPathListFileGroups` which should use **array** values like:

```json
"msr.default.extraSearchPathGroups": [
    "D:\\myLibs\\boost, d:\\myLibs\\common",
    "Project1 = D:\\git\\baseLib, D:\\git\\teamLib",
    "Project2 = D:\\git\\Project1 , D:\\git\\baseLib , D:\\git\\teamLib"
]
```

You can also set extra search paths for each type of coding language.

### Specific Coding Language Settings Examples

- `msr.cs.codeFiles`: Regex pattern of `C#` source code file names (extensions).**
- `msr.cpp.codeAndConfigDocs`: Regex pattern of `C++`  / `C` code + configuration + document files.
- `msr.py.extraSearchPaths`: **Extra search paths** for `Python` code's external repositories, dependency sources, or libraries, etc.
- `msr.ui.codeFiles`: Regex pattern of `UI` (front-end) code files: `*.vue`, `*.js`, `*.ts`, `*.jsx`, `*.tsx`.

## Normal and Extensive Search

 Normal Search (`default context menu`) + Extensive Search (`context meun` + `command palette`)

- Normal search:
  - Find definition (`Go to Definition` menu): Precise search **project root** + **extra paths** if set.
  - Find references (`Find All References` menu): **Only** search **project root**, **skip** extra paths even if set.
- Extensive search:
  - **Plain-text** and **Regex** searching groups in **command palette** and partially in **editor context menu**  (`Find plain text in xxx` or `Regex find xxx`)
  - Provide specific searching in **project root** + **extra paths** if set. For example, `Regex find pure references in code files` will skip comments and long text in code.

## Reuse the Command to Search Further or Replace Files

You can **reuse** [msr.EXE](https://github.com/qualiu/msr/tree/master/tools) `original search command line` in `Visual Studio Code` output channel `MSR-Def-Ref` or terminal `MSR-RUN-CMD` to **search** + **replace** files.

- Filter results or further search on results based on `original search command line`:
  
  Change the value of **-t** / **--np** / **--nd** if already used in command line.
  - Filter result text:
    - **-x** `"need plain text"` , **--nx** `"exclude plain-text"` , **--nt** `"exclude Regex"` , **-t** `"search/include Regex"`.
  - Filter result file name, folder, full-path:
    - **-d** `"match folders Regex"`, **--nd** `"exclude folder Regex"` , **--pp** `"full path Regex"` , - **--np** `"exclude full path Regex"`.
  - You can also add more `msr` commands to the command line like:
    - `msr original command` **|** `msr -i -t "^\s*public" -P -A -C`
  - Get matched file `list` (**-l**) -> Generate new command (**-o** `msr xxx`) -> Execute command (**-X**):
    - `msr original command` **-l** -PAC **|** `msr -t "(.+)" -o "msr -p \1 -t \"class To-Search\" --nx internal"` **-X**
- Replace files: Reuse the `find-reference` command line or write a new one:
  - See replaced text lines (add **-o** `replace-to-text`):
    - `msr original command ... -t "xxx" ...` **-o** `"replace-to"`
  - **Just** preview changed files (**-j**):
    - `msr original command ... -t "xxx" ...` **-o** `"replace-to"` **-j**
  - Replace files (**-R**):
    - `msr original command ... -t "xxx" ...` **-o** `"replace-to"` **-R**
    - Add **-K** if you want to backup changed files.
    - Add **--force** to replace files with `BOM` header except `UTF-8 0xEFBBBF`.

## Brief Usage Summary for Search or Configuration

Besides the [overview doc](https://github.com/qualiu/msr/blob/master/README.md) and [readme.txt](https://raw.githubusercontent.com/qualiu/msr/master/tools/readme.txt) here's brief summary:

- Easy to add, update or tune `Regex` patterns to improve existing or support new coding languages:
  - Use above debugging method with the output info.
  - Directly use the tiny and colorful [msr.EXE](https://github.com/qualiu/msr/tree/master/tools) of your [system type](#requirements) to test or tune your `Regex` patterns:
    - Input a string from input-arg (`-z`) or pipe (like `echo`):
      - msr **-z** `"class CPP_EXPORT MatchThisCppClass"` -t `"^\s*class (\w+\s+)?\bMatchThisCppClass"`
      - **echo** `class CPP_EXPORT MatchThisCppClass` `|` msr -t `"^\s*class (\w+\s+)?\bMatchThisCppClass"`
    - Input a file like:
      - msr **-p** `my-class.hpp` -t `"^\s*class (\w+\s+)?\bMatchThisCppClass"`
    - Input paths and recursively search like:
      - msr **-r -p** `my-class.hpp,src,folder2` -t `"^\s*class (\w+\s+)?\bMatchThisCppClass"`
- Use the rich searching options of [msr-EXE](https://github.com/qualiu/msr/blob/master/README.md) like below, **combine** these **optional** options (**You Can Use All**):
  - Filter text by `line-matching` (default) or `whole-file-text-matching` (add **-S** / **--single-line** Regex mode):
    - Ignore case:
      - Add **-i** (`--ignore-case`)
    - Regex patterns:
      - **-t** `should-match-Regex-pattern`
      - **--nt** `should-not-match-Regex-pattern`
    - Plain text:
      - **-x** `should-contain-plain-text`
      - **--nx** `should-not-contain-plain-text`
  - Filter `file name`: **-f** `should-match-Regex` , **--nf** `should-not-match`
  - Filter `directory name`: **-d** `at-least-one-match` , **--nd** `none-should-match`
  - Filter `full path pattern`: **--pp** `should-match` , **--np** `should-not-match`
  - Filter `file size`: **--s1** <= size <= **s2** , like set one or two: **--s1** `1B` **--s2** `1.5MB`
  - Filter `file time`: like **--w1** `2019-07`, **--w2** `"2019-07-16 13:20"` or `2019-07-16T13:20:01` (quote it if has spaces).
  - Filter rows by begin + end row numbers: like **-L** 10 **-N** 200 (for each file).
  - Filter rows by begin + end Regex: like **-b** `"^\s*public.*?class"` **-q** `"^\s*\}\s*$"`
  - Filter rows by 1 or more blocks: **-b** `"^\s*public.*?class"` **-Q** `"^\s*\}\s*$"`
  - Filter rows by 1 or more blocks + **stop** like: **-b** `"^\s*public.*?class"` **-Q** `"^\s*\}\s*$"` **-q** `"stop-matching-regex"`
  - Set max search depth (begin from input folder), like: **-k** `16` (default max search depth = `33`).
  - Set searching paths: (Can use both)
    - Recursively(`-r`) search one or more files or directories, like: **-r** **-p** `file1,folder2,file2,folder3,folderN`
    - Read paths (path list) from files, like: **-w** `path-list-1.txt,path-list-2.txt`
  - Skip/Exclude link files: **--xf**
  - Skip/Exclude link folders: **--xd**
  - **Quickly** pick up `head{N}` results + **Jump out**(`-J`), like: **-H** `30` **-J** or **-J** **-H** `300` or **-JH** `300` etc.
  - Not color matched text: **-C**  (`Faster` to output, and **must be set** for `Linux/Cygwin` to further process).
  - Output summary `info` to **stderr** + **hide** `warnings in stderr` (like BOM encoding): **-I** : You can see **-I -C** or **-IC** or **-J -I -C** or **-JIC** etc. in [package.json](https://github.com/qualiu/vscode-msr/blob/master/package.json)

## Welcome to Contribute

Github repository: <https://github.com/qualiu/vscode-msr>

You may just need to add or update the [configuration file](https://github.com/qualiu/vscode-msr/blob/master/package.json): Add or update `Regex` patterns of `find-references` or `find-definitions` for various coding languages.

### Add New Support or Improve

Please help to set the `Regex` patterns for them if you want. You can:

- Reference the `.definition` and `.reference` Regex patterns of **default** or a specific language type in [configuration file](https://github.com/qualiu/vscode-msr/blob/master/package.json).
- Debug this extension:
  - Use `Visual Studio Code` to open [this project](https://github.com/qualiu/vscode-msr) start (press `F5`) to debug, if you've cloned it.
  - Set/Check `msr.debug` to enable output debugging info, if you just installed this extension.
- See the docs [here](#brief-usage-summary-for-search-or-configuration) or on [msr](https://github.com/qualiu/msr/blob/master/README.md).

### Check and Update this doc
  
  Easy to check consistency of [configurations](https://github.com/qualiu/vscode-msr/blob/master/package.json) with `this document` by command lines below (you can also run command `npm run test` if you're a developer):

  **[nin](https://github.com/qualiu/msr/tree/master/tools)** `README.md` [package.json](https://github.com/qualiu/vscode-msr/blob/master/package.json) **"(msr\\.[\w\\.]+)"** --nt `"msr\.(exe|gcc\w+|cygwin)|project\d+|\.(My|xxx|extra\w+Group)"` -i -c Should no result

  **[nin](https://github.com/qualiu/msr/tree/master/tools)** `README.md` [package.json](https://github.com/qualiu/vscode-msr/blob/master/package.json) **"(msr\\.[\w\\.]+)"** --nt `"msr\.(exe|gcc\w+|cygwin)|project\d+|\.(My|xxx|extra\w+Group)"` -i **-m** -c Should have results

  **[nin](https://github.com/qualiu/msr/tree/master/tools)** [package.json](https://github.com/qualiu/vscode-msr/blob/master/package.json) nul -p -d -k 2 -x description -c Should no unreasonable duplicate descriptions.

## Known Issues

- Performance depends on system hardware conditions.
  
  For example, it may slower than usual if the disk (where code files stored) is busy, or slower than expected if the hardware is too old, or CPU is too busy.

- Current support of finding `definition` + `references`:
  - Near-precise support: Will show **multiple results** for **same name** `classes/methods/etc`, due to this is a light tool without syntax parsing and cache.
  - Near-precise support `class`, `methods`, `enum`, `field`, `property` for **C#**, **Python**, **Java**, **Scala**, **C++** / **C**.
  - Roughly support `class` and `method` for all type of languages (you can copy/write configurations follow existing languages).

  Welcome + Please help to improve searching definitions and references for `classes` and `methods`, and add supports for `enum` , `property`, `field` etc.

  See [Add New Support or Improve](#Add-New-Support-or-Improve).

## Release Notes

See [CHANGELOG](https://github.com/qualiu/vscode-msr/blob/master/CHANGELOG.md) or `vscode-msr` extension [commit history](https://github.com/qualiu/vscode-msr/commits/master).

-----------------------------------------------------------------------------------------------------------

**Enjoy!**
