/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Zongmin Lei <leizongmin@gmail.com> All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as leiDownload from "lei-download";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

let fileCache = {};
export function activate(context: vscode.ExtensionContext) {

  const CMD_QUICKOPEN = "extension.quickOpen";
  const CMD_QUICKOPEN_PATH = "extension.quickOpenPath";
  const CMD_QUICKOPEN_SEARCH = "extension.quickOpenSearch";
  const CMD_QUICKOPEN_SEARCH_CACHE_RESET = "extension.quickOpenSearchCacheReset";

  const HOME_DIR = os.homedir();

  function getRootPath(): string {
    return vscode.workspace.rootPath || "/";
  }

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  context.subscriptions.push(statusBar);
  let statusBarTid: NodeJS.Timer;

  let lastKeyword: string;
  let quickSearchPicker: vscode.QuickPick<any>;

  // config
  let searchIgnoreParterns: any[] = ["node_modules", "vendor", ".git", ".svn", ".hg", "CVS", ".history", "bower_components"];
  let maxSearchResult: number = 10;
  let keywordRegexFlags: string = '';

  function showStatusInfo(msg) {
    statusBar.text = msg;
    statusBar.color = "white";
    statusBar.show();
    autoHideStatusBar(2);
  }

  function showStatusWran(msg) {
    statusBar.text = msg;
    statusBar.color = "yellow";
    statusBar.show();
    autoHideStatusBar(10);
  }

  function autoHideStatusBar(s: number) {
    if (statusBarTid) {
      clearTimeout(statusBarTid);
    }
    statusBarTid = setTimeout(() => {
      statusBar.hide();
    }, s * 1000);
  }

  async function listDir(dir: string): Promise<vscode.QuickPickItem[]> {
    const list = await readdir(dir);
    const ret: vscode.QuickPickItem[] = [
      {
        description: "/",
        label: "/",
      },
      {
        description: path.resolve(dir, ".."),
        label: "..",
      },
      {
        description: HOME_DIR,
        label: "~",
      },
    ];
    for (const item of list) {
      const f = path.resolve(dir, item);
      ret.push({
        description: f,
        label: item,
      });
    }
    return ret;
  }

  function showFiles(pickedPath: string) {
    vscode.window.showQuickPick(listDir(pickedPath)).then((item) => {
      if (!item) {
        console.log("canceled pick");
        return;
      }
      vscode.commands.executeCommand(CMD_QUICKOPEN, item.description);
    });
  }

  function fixFilePath(file: string): string {
    if (file.slice(0, 2) === "~/" || file === "~") {
      file = HOME_DIR + file.slice(1);
    }
    return file;
  }

  function openDocument(file: string) {
    file = fixFilePath(file);
    console.log("openTextDocument", file);
    vscode.workspace.openTextDocument(file).then((doc) => {
      console.log("openTextDocument success", doc.fileName);
      vscode.window.showTextDocument(doc);
    });
  }

  function searchFiles(dir: string, keywords: any[], dirKeywords: any[], excludePaterns: any[], maxItems: number): string[] {
    let resultList = [];
    let isSkip = false;
    for (let index = 0; index < excludePaterns.length; index++) {
        const partern = excludePaterns[index];
        if (partern instanceof RegExp && partern.test(dir)) {
            isSkip = true;
            break;
        } else if (typeof partern === 'string' && dir.indexOf(partern) >= 0) {
            isSkip = true;
            break;
        }
    }
    if (isSkip) {
        return [];
    }
    const stats = fs.lstatSync(dir)
    if (!stats) {
        return [];
    }
    if (stats.isFile()) {
      let isMatch = true;
      for (let index = 0; index < keywords.length; index++) {
        const keyword = keywords[index];
        if (keyword instanceof RegExp && !keyword.test(dir)) {
          isMatch = false;
          break
        } else if (typeof keyword === 'string' && dir.indexOf(keyword) < 0) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        resultList.push(dir);
      }
      return resultList;
    } else if (stats.isDirectory()) {
      let isMatch = true;
      for (let index = 0; index < dirKeywords.length; index++) {
        const keyword = keywords[index];
        if (keyword instanceof RegExp && !keyword.test(dir)) {
          isMatch = false;
          break
        } else if (typeof keyword === 'string' && dir.indexOf(keyword) < 0) {
          isMatch = false;
          break;
        }
      }
      if (!isMatch) {
        return resultList;
      }
      const files = fs.readdirSync(dir);

      for (let index = 0; index < files.length; index++) {
          if (maxItems && resultList.length >= maxItems) {
              break;
          }
          const list = searchFiles(path.resolve(dir, files[index]), keywords, dirKeywords, excludePaterns, maxItems ? (maxItems - resultList.length) : maxItems);
          resultList = resultList.concat(list)
      }
      return resultList;
    }
    return resultList;
  }

  function searchFilesInCache(dir: string, keywords: any[], dirKeywords: any[], excludePaterns: any[], maxItems: number): string[]
  {
    if (!fileCache[dir]) {
      showStatusInfo(`QuickOpen caching files in ${ dir }`);
      fileCache[dir] = searchFiles(dir, [], [], excludePaterns, 0);
    }
    const resultList = [];
    for (let index = 0; index < fileCache[dir].length; index++) {
      const file = fileCache[dir][index];
      if (typeof file !== 'string') {
        console.log("Error file in fileCache: ", dir, index, file);
        continue;
      }
      const fileName = path.basename(file);
      const dirName = path.dirname(file);
      let isMatch = true;
      for (let index = 0; index < keywords.length; index++) {
        const keyword = keywords[index];
        if (keyword instanceof RegExp && !keyword.test(fileName)) {
          isMatch = false;
          break;
        } else if (typeof keyword === 'string' && fileName.indexOf(keyword) < 0) {
          isMatch = false;
          break;
        }
      }
      if (!isMatch) {
        continue;
      }
      for (let index = 0; index < dirKeywords.length; index++) {
        const keyword = dirKeywords[index];
        if (keyword instanceof RegExp && !keyword.test(dirName)) {
          isMatch = false;
          break
        } else if (typeof keyword === 'string' && dirName.indexOf(keyword) < 0) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        resultList.push(file);
      }
      if (resultList.length >= maxItems) {
        break;
      }
    }
    return resultList;
  }

  function showSearchPicker() {
    if (!quickSearchPicker) {
      quickSearchPicker = vscode.window.createQuickPick();
      // quickSearchPicker.ignoreFocusOut = true;
      quickSearchPicker.title = "Search File In Current Workspace";
      quickSearchPicker.placeholder = "Input some words to search file in workspace."
      quickSearchPicker.onDidChangeSelection(function(items){
        openDocument(path.resolve(items[0].description, items[0].label.split(/\s+/).pop()));
      });
      quickSearchPicker.onDidHide(function() {
        quickSearchPicker.value = '';
      });
      quickSearchPicker.onDidChangeValue(async (keyword) => {
        if (quickSearchPicker.busy) {
          return;
        }
        keyword = keyword.trim();
        if (!keyword) {
          quickSearchPicker.items = [];
          return;
        }
        lastKeyword = keyword;
        quickSearchPicker.busy = true;
        // search patern  `aa bb`  `a/b` `a/b c` `c/d/ aa`
        const ret: vscode.QuickPickItem[] = [];
        const keywords = keyword.split(/\s+/);
        let dirKeywordRegex = [];
        let lastDirKeywordRegex;
        if (keywords[0].indexOf('/') >= 0) {
          const dirKeywords = keywords.shift();
          dirKeywordRegex = dirKeywords.split(/\/+/).filter(v => v).map(k => new RegExp(k, keywordRegexFlags));
          if (!dirKeywords.endsWith('/')) {
            lastDirKeywordRegex = dirKeywordRegex.pop();
          }
        }
        const fileNameKeywordRegexs = keywords.map((k) => new RegExp(k, keywordRegexFlags));
        if (lastDirKeywordRegex) {
          fileNameKeywordRegexs.unshift(lastDirKeywordRegex);
        }

        for (let folder of vscode.workspace.workspaceFolders) {
          if ((!folder.uri.scheme || folder.uri.scheme === 'file') && ret.length < maxSearchResult) {
            try {
              const list = searchFilesInCache(folder.uri.path, fileNameKeywordRegexs, dirKeywordRegex, searchIgnoreParterns, maxSearchResult);
              if (keyword !== lastKeyword) {
                break;
              }
              for (let index = 0; index < list.length; index++) {
                if (ret.length >= maxSearchResult) {
                  break;
                }
                const file = list[index];
                ret.push({
                  description: path.dirname(file),
                  label: `$(file) ${path.basename(file)}`,
                  alwaysShow: true,
                })
              }
            } catch (err) {
              console.log(err);
              vscode.window.showErrorMessage(err && err.message || String(err));
              continue;
            }
          }
        }
        quickSearchPicker.busy = false;

        if (keyword === lastKeyword) {
          quickSearchPicker.items = ret;
        }
      });
    }
    quickSearchPicker.busy = false;
    quickSearchPicker.value = '';
    quickSearchPicker.show();
  }

  maxSearchResult = vscode.workspace.getConfiguration('quickOpen').get('maxSearchResult');
  searchIgnoreParterns = vscode.workspace.getConfiguration('quickOpen').get('searchIgnoreParterns');
  keywordRegexFlags=keywordRegexFlags.replace('i', '') + (vscode.workspace.getConfiguration('quickOpen').get('searchIgnoreCase') ? 'i' : '')
  searchIgnoreParterns = searchIgnoreParterns.map((v)=>new RegExp(v, keywordRegexFlags));

  vscode.workspace.onDidChangeConfiguration(function(e) {
    maxSearchResult = vscode.workspace.getConfiguration('quickOpen').get('maxSearchResult');
    searchIgnoreParterns = vscode.workspace.getConfiguration('quickOpen').get('searchIgnoreParterns');
    keywordRegexFlags=keywordRegexFlags.replace('i', '') + (vscode.workspace.getConfiguration('quickOpen').get('searchIgnoreCase') ? 'i' : '')
    searchIgnoreParterns = searchIgnoreParterns.map((v)=>new RegExp(v, keywordRegexFlags));
    fileCache = {};
  });

  context.subscriptions.push(vscode.commands.registerCommand(CMD_QUICKOPEN, async (pickedPath: string) => {
    if (typeof pickedPath !== "string") {
      console.log("pickedPath is not a string");
      console.log(pickedPath);
      pickedPath = "";
    }
    try {
      pickedPath = pickedPath || getRootPath();
      console.log("quickOpen", pickedPath);
      pickedPath = fixFilePath(pickedPath);
      const s = await readFileStats(pickedPath);
      if (s.isFile()) {
        openDocument(pickedPath);
        return;
      }
      if (s.isDirectory()) {
        showFiles(pickedPath);
        return;
      }
    } catch (err) {
      vscode.window.showErrorMessage(err && err.message || String(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(CMD_QUICKOPEN_PATH, async (inputPath: string) => {
    if (typeof inputPath !== "string") {
      console.log("inputPath is not a string");
      console.log(inputPath);
      inputPath = "";
    }
    if (!inputPath) {
      inputPath = await vscode.window.showInputBox({
        prompt: "Enter the file path to open",
      });
    }
    if (isURL(inputPath)) {
      showStatusInfo(`Downloading ${ inputPath }`);
      try {
        inputPath = await download(inputPath, (size, total) => {
          console.log("download progress: ", size, total);
          if (total) {
            showStatusInfo(`Downloading ${ (size / total * 100).toFixed(1) }%`);
          } else {
            showStatusInfo(`Downloading ${ (size / 1024).toFixed(0) }KB`);
          }
        });
      } catch (err) {
        showStatusWran(err.message);
      }
    } else {
      inputPath = path.resolve(getRootPath(), inputPath);
    }
    vscode.commands.executeCommand(CMD_QUICKOPEN, inputPath);
  }));

  context.subscriptions.push(vscode.commands.registerCommand(CMD_QUICKOPEN_SEARCH, async () => {
    try {
      showSearchPicker();
    } catch (err) {
      console.log(err)
      vscode.window.showErrorMessage(err && err.message || String(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(CMD_QUICKOPEN_SEARCH_CACHE_RESET, async () => {
    try {
      fileCache = {};
      showStatusInfo(`QuickOpen caches cleared`);
    } catch (err) {
      vscode.window.showErrorMessage(err && err.message || String(err));
    }
  }));
}

export function deactivate() { }

/**
 * returns file stats
 */
function readFileStats(filename: string): Promise<fs.Stats> {
  return new Promise((resolve, reject) => {
    fs.stat(filename, (err, stats) => {
      if (err) {
        return reject(err);
      }
      resolve(stats);
    });
  });
}

/**
 * returns directory files
 */
function readdir(dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (err, list) => {
      if (err) {
        return reject(err);
      }
      resolve(list);
    });
  });
}

/**
 * download remote file and returns local temp path
 */
function download(url: string, onProgress: (size: number, total: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    leiDownload(url, getTempNameFromURL(url), onProgress, (err, fileName) => {
      if (err) {
        reject(err);
      } else {
        resolve(fileName);
      }
    });
  });
}

/**
 * returns temp file name from input URL
 */
function getTempNameFromURL(url: string): string {
  const ext = path.extname(url);
  const fileName = path.resolve(os.tmpdir(), randomString(20) + ext);
  return fileName;
}

/**
 * returns random string
 */
function randomString(size: number): string {
  size = size || 6;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const max = chars.length + 1;
  let str = "";
  while (size > 0) {
    str += chars.charAt(Math.floor(Math.random() * max));
    size -= 1;
  }
  return str;
}

/**
 * returns true if the input string is an URL
 */
function isURL(url: string): boolean {
  return url.slice(0, 7) === "http://" || url.slice(0, 8) === "https://";
}
