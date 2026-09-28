const { createHash } = require('crypto')
const fs = require('fs')
const os = require('os')

const inputFolder = '/data/inputs'
const outputFolder = '/data/outputs'

const startTime = new Date()
var dateField = false
var result = {
  fileCount: 0,
  files: {}
}

const dateFieldNames = ['date', 'datetime', 'day']

const calculations = {
  numLines: 0,
  sum: {},
  length: {},
  avg: {},
  min: {},
  max: {}
}

const ranges = {
  value: null,
  date: 'N/A'
}

async function processInput(path) {
  console.log(`Starting to look for files in ${path}...`)

  try {
    const files = fs.readdirSync(path)
    files.map(async (file, i) => {
      await handleFile(`${path}/${file}`)
    })
  } catch (err) {
    console.error(err)
  }
}

function getJSON(file_string) {
  var data = null
  try {
    data = JSON.parse(file_string)
  } catch (err) {
    console.error(err)
    data = null
  } finally {
    return data
  }
}

async function handleFile(filepath) {
  try {
    const stats = fs.statSync(filepath)

    if (stats.isDirectory()) {
      console.log(`Found directory at ${filepath}`)
      await processInput(filepath)
    } else {
      result.fileCount++
      const file = fs.readFileSync(filepath)
      const file_string = file.toString()
      const data = getJSON(file_string)
      printFileInfo(filepath, stats, file_string)
      result.files[filepath] = { ...calculations }
      result.files[filepath].numLines = await countLines(filepath, file_string)

      if (data) {
        calcResults(filepath, data)
      } else {
        console.log(`Could not find valid JSON for file "${filepath}"`)
      }
    }
  } catch (err) {
    console.error(err)
  }
}

function calcResults(filepath, _data) {
  console.log(`Calculating results for ${filepath}...`)
  if (typeof _data !== 'object') {
    console.warn(
      `Expected a JSON object as data from "${filepath}" but got [${typeof _data}]. Skipping file.`
    )
    return
  }

  const keys = Object.keys(_data)
  var data = {}
  keys.map((key) => {
    data[key.toLowerCase()] = _data[key]
  })

  var dateField = null
  dateFieldNames.forEach((name) => {
    if (Object.keys(data).includes(name)) {
      dateField = name
      return false
    }
  })

  for (const [key, array] of Object.entries(data)) {
    if (key === dateField) continue
    console.log(`Calculating for field "${key}"...`)

    if (!Array.isArray(array)) {
      console.warn(
        `Expected an array as value for "${key}" but got [${typeof array}]. Continuing...`
      )
      continue
    }

    try {
      result.files[filepath].length[key] = array.length
      result.files[filepath].sum[key] = 0
      result.files[filepath].avg[key] = 0
      result.files[filepath].min[key] = { ...ranges }
      result.files[filepath].max[key] = { ...ranges }

      array.forEach((value, i) => {
        //Calculate sums
        result.files[filepath].sum[key] += parseFloat(value)
        //Calc min
        const min = result.files[filepath].min[key].value
        if (value < min || min === null) {
          result.files[filepath].min[key].value = value
          if (dateField !== null)
            result.files[filepath].min[key].date = data[dateField][i] || 'N/A'
        }
        //Calc max
        const max = result.files[filepath].max[key].value
        if (value > max || max === null) {
          result.files[filepath].max[key].value = value
          if (dateField !== null)
            result.files[filepath].max[key].date = data[dateField][i] || 'N/A'
        }
      })

      //Calculate avgs
      for (const [key, sum] of Object.entries(result.files[filepath].sum)) {
        result.files[filepath].avg[key] =
          sum / result.files[filepath].length[key]
      }
    } catch (err) {
      console.error(err)
    }
  }
  delete result.files[filepath].sum
  delete result.files[filepath].length

  console.log(`Results calculated.`)
}

async function writeResults() {
  console.log(`Writing results...`)
  try {
    fs.writeFileSync(
      `${outputFolder}/results.json`,
      JSON.stringify(result, null, 2)
    )
    console.log(`Written results to ${outputFolder}/results.json`)
  } catch (err) {
    console.error(err)
  }
}

function countLines(filepath, file_string) {
  console.log(`Counting lines for file ${filepath}...`)
  return file_string.split('\n').length - 1
}

function printFileInfo(filepath, stats, file_string) {
  console.log('\n================== FILE INFO ===================')
  console.log(`File: ${filepath}`)
  console.log(`Size: ${stats.size}B`)
  console.log(`Hash: ${createHash('sha256').update(file_string).digest('hex')}`)
  console.log('=================================================\n')
}

function printIntro() {
  console.log('=================================================')
  console.log('***  This demo algorithm is brought to you by ***')
  console.log('          _      _ _        ____    _    ___  ')
  console.log('       __| | ___| | |_ __ _|  _ \\  / \\  / _ \\  ')
  console.log('      / _` |/ _ \\ | __/ _` | | | |/ _ \\| | | | ')
  console.log('     | (_| |  __/ | || (_| | |_| / ___ \\ |_| | ')
  console.log('      \\__,_|\\___|_|\\__\\__,_|____/_/   \\_\\___/  \n')
  console.log('                       ***\n')
  console.log('                  delta-dao.com\n')
  console.log('                       ***\n')
  console.log('=================================================')
}

function printOutro() {
  const endTime = new Date()
  console.log('\n============== ALGORITHM FINISHED ===============')
  console.log(`End Time:        ${printableDate(endTime)}`)
  console.log(`Execution Time:  ${endTime - startTime}ms`)
  console.log(`# of Files:      ${result.fileCount}`)
  console.log('=================================================\n')
}

function printSystemInfo() {
  console.log('\n================== SYSTEM INFO ==================')
  console.log(`Start Time:  ${printableDate(startTime)}`)
  console.log(`OS:`)
  console.log(`- Name:      ${os.hostname()}`)
  console.log(`- Type:      ${os.type()}`)
  console.log(`- Version:   ${os.version()}`)
  console.log(
    `- Memory:    ${Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 100) / 100}GB`
  )
  console.log(`- CPU's:`)
  os.cpus().map((cpu) => {
    console.log(`   * ${cpu.model}`)
  })
  console.log('=================================================\n')
}

function printableDate(_date) {
  const date = new Date(_date)
  return date.toLocaleString('en-US', { hour12: false, timeZoneName: 'short' })
}

async function runAlgorithm() {
  printIntro()
  printSystemInfo()
  await processInput(inputFolder)
  await writeResults()
  printOutro()
}

runAlgorithm()
