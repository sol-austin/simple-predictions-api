const https = require('https')
const Match = require('../models/user').match

exports.games = async () => {
  return await new Promise((resolve, reject) => {
    console.log('Games called')
    const options = {
      host: 'footballapi.pulselive.com',
      path: '/football/fixtures?comps=1&teams=1,2,130,131,43,4,6,7,9,26,10,11,12,23,14,20,21,33,25,38&compSeasons=418&page=0&pageSize=1000&sort=asc&statuses=C,U,L&altIds=true',
      method: 'GET',
      port: 443,
      headers: { Origin: 'https://www.premierleague.com' }
    }

    https.get(options, resp => {
      let data = ''

      resp.on('data', c => {
        data += c
      })

      resp.on('end', async () => {
        const json = JSON.parse(data)
        await updateFixtures(json)
        resolve('Fixtures complete')
      })

      resp.on('error', e => {
        console.log(e)
      })
    })
  })
}

async function updateFixtures (json) {
  return await new Promise((resolve, reject) => {
    console.log('updating fixtures')

    const games = json.content
    const updates = []
    for (let i = 0; i < games.length; i++) {
      const game = games[i]
      const homeTeam = game.teams[0].team.name
      const awayTeam = game.teams[1].team.name
      const gameweek = game.gameweek.gameweek
      const kickOffTime = game.kickoff.millis
      console.log(`${homeTeam} vs ${awayTeam} gw ${gameweek} millis ${kickOffTime}`)

      const update = Match.findOneAndUpdate({ home_team: homeTeam, away_team: awayTeam }, { gameweek: gameweek, kick_off_time: kickOffTime }, { new: true, upsert: true, setDefaultsOnInsert: true, useFindAndModify: false })
      updates.push(update)
    }
    Promise.all(updates).then(() => resolve('Database updated'))
  })
}
