const https = require('https')
const Twit = require('twit')
// const { scoreGames } = require('../scoring');
const env = require('dotenv').config().parsed || process.env
const Match = require('../models/user').match
const Prediction = require('../models/user').prediction

const T = new Twit({
  consumer_key: 'QBylbtuQn0WGoEgVAmp9LUoxB',
  consumer_secret: env.TWIT_CONSUMER_SECRET,
  access_token: '1437049270918582272-a7mpgMkoLCLf2eeMCj3sRHtHori0va',
  access_token_secret: env.TWIT_ACCESS_TOKEN_SECRET,
  timeout_ms: 60 * 1000 // optional HTTP request timeout to apply to all requests.
})

exports.scoreGames = () => {
  console.log('score games /services/scoring.js called')
  return new Promise(function (resolve, reject) {
    let games
    Match.find({}).populate('predictions').exec(async (err, result) => {
      if (err) throw err
      games = result

      if (!games) {
        reject(new Error('Error: Games array empty. Database is empty!'))
      }
      // Loop through array of games
      for (let i = 0; i < games.length; i++) {
        const game = games[i]
        // const homeTeam = game.home_team
        // const awayTeam = game.away_team
        // const gameID = game._id
        const newData = { $set: {} }
        const predictions = game.predictions
        for (let x = 0; x < predictions.length; x++) {
          const prediction = predictions[x]
          const predID = prediction._id
          const predHome = prediction.home_pred
          const predAway = prediction.away_pred
          const liveHome = game.live_home_score
          const liveAway = game.live_away_score
          const bankerMult = game.banker_multiplier
          const banker = prediction.banker || false
          const insurance = prediction.insurance || false
          const points = calculateScores(predHome, predAway, liveHome, liveAway, banker, insurance, bankerMult)
          newData.$set.points = points
          console.log(predID, newData)
          await new Promise(resolve => {
            Prediction.updateOne({ _id: predID }, newData, function (err, result) {
              if (err) throw err
              resolve()
            })
          })
        }
      }
      resolve()
    })
  })
}

const scoreGames = exports.scoreGames

function calculateScores (predHome, predAway, liveHome, liveAway, banker, insurance, bankerMult) {
  // For now fixed banker mult
  bankerMult = bankerMult || 3
  let points
  // Check if predictions present
  if (predHome == null || predAway == null || liveHome == null || liveAway == null) {
    points = 0
  } else {
    // Check if exactly correct
    if (predHome === liveHome && predAway === liveAway) {
      points = 30
    } else {
      // Check if draw
      if (predHome === predAway && liveHome === liveAway) {
        points = 20
      } else {
        // Check if correct goal difference
        if ((predHome - liveHome) === (predAway - liveAway)) {
          points = 15
        } else {
          // Check if result correct
          if (((predHome > predAway) && (liveHome > liveAway)) || ((predHome < predAway) && (liveHome < liveAway))) {
            points = 10
          } else {
            points = -10
          }
        }
      }
    }
  }

  // Now apply banker and insurance chips
  if ((points < 0) && (insurance)) {
    points = 0
  }
  if (banker) {
    points = points * bankerMult
  }
  return points
}

exports.calculateScores = calculateScores

function fixTeamNameProblems (name) {
  name = name.replace('AFC', '')
  name = name.replace('FC', '')
  name = name.replace('&', 'and')
  name = name.trim()
  if (name === 'Brighton & Hove Albion') { name = 'Brighton' }
  return name
}

async function parseTwitterLiveScores (result) {
  const tweets = result.data
  // tweets = ['test']
  // Loop through last 10 tweets from official Premier League account
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i]
    const tweetText = tweet.text
    // DEBUG: tweet_text = "GOAL Liverpool 1-3 Bournemouth (72 mins) Champions respond! Leroy Sane drills low across goal from the left and his pinpoint effort goes in off the post #MCILIV"
    // Check if tweet announces a goal
    if (!tweetText) {
      continue
    }
    if (!tweetText.startsWith('GOAL ')) {
      // Skips the iteration of this tweet
      continue
    }
    // We now know that the tweet annouces a goal in the standard format
    // Find brackets in tweet which signify end of teams and score
    const splitTweet = tweetText.split(/[()]+/)
    // Filter after keyword goal
    const finalTweet = splitTweet[0].split('GOAL ')[1]
    // final_tweet should contain 'HomeName HomeScore-AwayScore AwayName'
    // Find score
    const scoreIndex = finalTweet.search(/\d.*\d/)
    const score = finalTweet.substring(scoreIndex, scoreIndex + 3)
    const scoreArr = score.split('-')
    const homeScore = parseInt(scoreArr[0])
    const awayScore = parseInt(scoreArr[1])
    const combinedScore = homeScore + awayScore
    // Split into team names
    const teams = finalTweet.split(/\s\d.*\d\s/)
    let homeTeam = teams[0]
    let awayTeam = teams[1].split(/ [^ ]*$/)[0]
    homeTeam = fixTeamNameProblems(homeTeam)
    awayTeam = fixTeamNameProblems(awayTeam)
    await new Promise(resolve => {
      Match.findOne({ home_team: homeTeam, away_team: awayTeam }, async function (err, result) {
        if (err) throw err
        if (result == null || homeScore == null) {
          await scoreGames()
          resolve()
        } else {
          if (result.live_home_score + result.live_away_score < combinedScore || result.live_home_score == null) {
            // Update the score as it is greater than the previous score
            const id = result._id
            console.log('set score in updatelivescores: ' + homeTeam + ' vs ' + awayTeam + ' to ' + homeScore + ' - ' + awayScore)
            await new Promise((resolve, reject) => {
              Match.updateOne({ _id: id }, { $set: { live_home_score: homeScore, live_away_score: awayScore } }, async function (err, result) {
                if (err) throw err
                await scoreGames()
                resolve()
              })
            })
          // Call score game to update the scoring
          }
          await scoreGames()
          resolve()
        }
      })
    })
  }
  return result
}

exports.parseTwitterLiveScores = parseTwitterLiveScores

exports.updateLiveScores = async () => {
  console.log('scoring live games begin')
  await scoreGames()
  // Get request used rather than streaming because it can be filtered by account (more narrowly)
  T.get('statuses/user_timeline', { user_id: 343627165, count: 50 }).then(async function (result) {
    await parseTwitterLiveScores(result)
  })
}

exports.updateTodayGames = () => {
  console.log('updating todays games')
  const date = new Date().toISOString().split('T')[0]
  const options = {
    hostname: 'api.football-data.org',
    path: '/v2/competitions/PL/matches?dateFrom=' + date + '&dateTo=' + date,
    method: 'GET',
    headers: {
      'X-Auth-Token': env.FOOTBALL_DATA_API_AUTH
    }
  }
  return new Promise(resolve => {
    https.get(options, res => {
      let data = ''
      res.on('data', d => {
        data += d
      })
      res.on('end', async () => {
        const json = JSON.parse(data)
        console.log(JSON.stringify(json))
        await exports.updateDBScoresFootballData(json)
        resolve()
      })
    })
  })
}

exports.updateFootballDataScores = async optionalGameweek => {
  console.log('updateFootballDataScores called')
  let options = {
    hostname: 'api.football-data.org',
    path: '/v2/competitions/PL',
    method: 'GET',
    headers: {
      'X-Auth-Token': env.FOOTBALL_DATA_API_AUTH
    }
  }
  let matchday = await new Promise((resolve, reject) => https.get(options, res => {
    let data = ''
    res.on('data', d => {
      data += d
    })
    res.on('end', () => {
      const json = JSON.parse(data)
      const innerMatchday = checkMatchday(json)
      resolve(innerMatchday)
    })
  }))
  // Use function param if given or alternatively use calculated current gameweek
  matchday = optionalGameweek || matchday
  console.log('matchday is ' + matchday)
  options = {
    hostname: 'api.football-data.org',
    path: '/v2/competitions/PL/matches?matchday=' + matchday,
    method: 'GET',
    headers: {
      'X-Auth-Token': env.FOOTBALL_DATA_API_AUTH
    }
  }
  return new Promise(resolve => {
    https.get(options, res => {
      let data = ''
      res.on('data', d => {
        data += d
      })
      res.on('end', async () => {
        const json = JSON.parse(data)
        await exports.updateDBScoresFootballData(json)
        resolve()
      })
    })
  })
}

function checkMatchday (json) {
  const matchday = json.currentSeason.currentMatchday
  return matchday
}

async function updateDBScoresFootballData (json) {
  const matches = json.matches
  if (!matches) {
    throw (new Error('Matches not valid please check sentry ffs'))
  }
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    let homeTeam = match.homeTeam.name
    let awayTeam = match.awayTeam.name
    const homeScore = match.score.fullTime.homeTeam
    const awayScore = match.score.fullTime.awayTeam
    const status = match.status
    homeTeam = fixTeamNameProblems(homeTeam)
    awayTeam = fixTeamNameProblems(awayTeam)
    const combinedScore = homeScore + awayScore
    if ((homeTeam && awayTeam) && (homeScore || homeScore === 0) && (awayScore || awayScore === 0)) {
      console.log(`Currently checking in updateDBScoresFootballData for: ${homeTeam} vs ${awayTeam} with a final score of ${homeScore}-${awayScore}`)
    }
    await new Promise((resolve, reject) => {
      Match.findOne({ home_team: homeTeam, away_team: awayTeam }, async function (err, result) {
        if (err) throw err
        if (!result) {
          console.log(match)
          reject(new Error('Match not found'))
        }
        if (result.status !== status) {
          Match.updateOne({ _id: result.id }, { $set: { status: status } }, function (err) {
            if (err) throw err
            console.log('game status updated for ' + homeTeam + ' vs ' + awayTeam + ' to ' + status)
          })
        }
        if (homeScore == null) {
          if (homeScore == null && awayScore == null && result.kick_off_time < Date.now() && !(result.live_home_score > 0) && !(result.live_away_score > 0)) {
            console.log('set score in updatedbfootballdata1 ' + homeTeam + ' vs ' + awayTeam + ' to 0-0')
            await new Promise((resolve, reject) => {
              Match.updateOne({ _id: result._id }, { $set: { live_home_score: 0, live_away_score: 0 } }, function (err, result) {
                if (err) throw err
                console.log('set scores to 0')
                resolve()
              })
            })
          }
          resolve()
        } else {
          const id = result._id
          if (result.live_home_score + result.live_away_score < combinedScore || result.live_home_score == null || result.status === 'FINISHED') {
            // Update the score as it is greater than the previous score
            console.log('set score in updatedbfootballdata2 ' + homeTeam + ' vs ' + awayTeam + ' to ' + homeScore + ' - ' + awayScore + ' with id ' + id)
            await new Promise((resolve, reject) => {
              Match.updateOne({ _id: id }, { $set: { live_home_score: homeScore, live_away_score: awayScore, status: status } }, function (err, result) {
                if (err) throw err
                console.log('score updated through football-data api')
                resolve()
              })
            })
            await scoreGames()
          }
          resolve()
        }
      })
    })
  }
}

exports.updateDBScoresFootballData = updateDBScoresFootballData
