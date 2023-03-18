import fs = require('fs');
import { outputErrorByTime, outputInfoByTime } from "./outputUtils";

export function saveTextToFile(filePath: string, text: string, info: string = 'file', tryTimes: number = 3): boolean {
  for (let k = 1; k <= tryTimes; k++) {
    try {
      fs.writeFileSync(filePath, text);
      if (k > 1) {
        outputInfoByTime('Times-' + k + ': Successfully saved ' + info + ': ' + filePath);
      }
      return true;
    } catch (err) {
      outputErrorByTime('Times-' + k + ': Failed to save ' + info + ': ' + filePath + ' Error: ' + err);
      if (k >= tryTimes) {
        return false;
      }
    }
  }

  return false;
}

export function readTextFile(filePath: string): string {
  try {
    const text = fs.readFileSync(filePath);
    return !text ? '' : text.toString();
  } catch (err) {
    outputErrorByTime('Failed to read file: ' + filePath + ', error: ' + err);
    return '';
  }
}

export function createDirectory(folder: string): boolean {
  if (fs.existsSync(folder)) {
    return true;
  }

  try {
    fs.mkdirSync(folder);
    return true;
  } catch (err) {
    outputErrorByTime('Failed to make single script folder: ' + folder + ' Error: ' + err);
    return false;
  }
}
