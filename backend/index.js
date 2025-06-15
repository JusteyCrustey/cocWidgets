//setup
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const app = express();

// rate-limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15min
  max: 100,                 // limit 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
});

app.use(limiter);

// player
app.get('/player/:tag', async (req, res) => {
  try {
    // get tag
    const playerTag = encodeURIComponent(req.params.tag);
    // coc api call
    const apiRes = await axios.get(
      `https://api.clashofclans.com/v1/players/${playerTag}`, {
        headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
      }
    );

    res.json(apiRes.data);

  } catch (err) {
    res.status((err.response && err.response.status) || 500)
       .json({ error: err.message });
  }
});

//war
app.get('/war/:tag', async (req, res) => {
  try {
    // get tag
    const playerTag = encodeURIComponent(req.params.tag);
    // coc player api call
    const playerapi = await axios.get(
      `https://api.clashofclans.com/v1/players/${playerTag}`, {
        headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
      }
    );
    playerData = playerapi.data;

    // get clan tag
    const clanTag =  encodeURIComponent(playerData.clan.tag);

    // coc clan war api call
    try {
      const clanWarapi = await axios.get(
        `https://api.clashofclans.com/v1/clans/${clanTag}/currentwar`, {
          headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
        }
      );
      clanWarData = clanWarapi.data;
    } catch (err) {
      if (err.response.status === 403) {
        // no war
        clanWarData = { state: 'private' };
        CWLData = { state : 'private' };
        
      } else {
        throw err; // rethrow other errors
      }
    }

    // coc CWL api call
    const status = ['','','','','','','']
    CWLCurrWarData=null;
    ourClan = null;
    opponentClan = null;
    if (clanWarData.state === 'notInWar' && clanWarData.state !== 'private') {
      try {
        const CWLapi = await axios.get(
          `https://api.clashofclans.com/v1/clans/${clanTag}/currentwar/leaguegroup`, {
            headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
          }
        );
        CWLData = CWLapi.data;

        if (CWLData.state !== 'notInWar') {
          for (let i = 0; i < CWLData.rounds.length; i++) {
            for (let j = 0; j < CWLData.rounds[i].warTags.length; j++) {
              warTag = encodeURIComponent(CWLData.rounds[i].warTags[j]);
              const CWLWarapi = await axios.get(
                `https://api.clashofclans.com/v1/clanwarleagues/wars/${warTag}`, {
                  headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
                }
              );
              CWLWarData = CWLWarapi.data;
              
              if (CWLWarData.clan.tag === playerData.clan.tag) {
              ourClan = CWLWarData.clan;
              opponentClan = CWLWarData.opponent;
              } else if (CWLWarData.opponent.tag === playerData.clan.tag) {
              ourClan = CWLWarData.opponent;
              opponentClan = CWLWarData.clan;
              } else {
              continue; // skip if neither matches
              }
              if (CWLWarData.state === 'warEnded') {
                status[i] = ourClan.stars > opponentClan.stars ? 'won' : (ourClan.stars < opponentClan.stars ? 'lost' : 'draw');
              } else if (CWLWarData.state === 'inWar') {
                status[i] = 'inWar';
                CWLCurrWarData = CWLWarData;
              }
              break;
            }
          }
        }
        

      } catch (err) {
        if (err.response.status === 404) {
          CWLData = { state: 'notInWar' };
        } else {
          throw err; // rethrow other errors
        }
      }
    }
    
    const inWar = clanWarData.state !== 'notInWar' && clanWarData.state !== 'private' ? clanWarData.state : (CWLData.state === 'inWar' ? 'cwl' : CWLData.state),

    // prepare data
    out = {
      inWar: inWar,
      player: {
        tag: playerData.tag,
        name: playerData.name,
        townHallLevel: playerData.townHallLevel,
      },
      clan: {
        name: playerData.clan.name,
        tag: playerData.clan.tag,
        badgeUrls: playerData.clan.badgeUrls, //small, medium, large
      }
    };

    // player data
    if (inWar !== 'notInWar' && inWar !== 'private') {
      out.player.isParticipating = inWar !== "cwl"
        ? (clanWarData.clan.members.find(member => member.tag === playerData.tag) ? 'yes' : 'no')
        : (ourClan.members.find(member => member.tag === playerData.tag) ? 'yes' : 'no');
      out.player.mapPosition = inWar !== "cwl"
        ? (clanWarData.clan.members.find(member => member.tag === playerData.tag)?.mapPosition)
        : (ourClan.members.find(member => member.tag === playerData.tag)?.mapPosition);
      
      if (out.player.isParticipating === 'yes') {
        out.player.attacks = inWar !== "cwl"
          ? (clanWarData.clan.members.find(member => member.tag === playerData.tag)?.attacks || [])
          : (ourClan.members.find(member => member.tag === playerData.tag)?.attacks || []);
        await Promise.all(
          out.player.attacks.map(async (attack) => {
            const defender = await axios.get(
              `https://api.clashofclans.com/v1/players/${encodeURIComponent(attack.defenderTag)}`,
              { headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` } }
            );
            attack.defenderName = defender.data.name;
            attack.defenderTownHallLevel = defender.data.townHallLevel;

            attack.defenderMapPosition = inWar !== "cwl"
              ? (clanWarData.opponent.members.find(member => member.tag === attack.defenderTag).mapPosition)
              : (opponentClan.members.find(member => member.tag === attack.defenderTag).mapPosition);
          })
        
        );
        out.player.defense = inWar !== "cwl"
          ? (clanWarData.clan.members.find(member => member.tag === playerData.tag)?.bestOpponentAttack || {})
          : (ourClan.members.find(member => member.tag === playerData.tag)?.bestOpponentAttack || {});
        
        if (out.player.defense && out.player.defense.attackerTag) {
          const attacker = await axios.get(
            `https://api.clashofclans.com/v1/players/${encodeURIComponent(out.player.defense.attackerTag)}`,
            { headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` } }
          );
          out.player.defense.attackerName = attacker.data.name;
          out.player.defense.attackerTownHallLevel = attacker.data.townHallLevel;
          out.player.defense.attackerMapPosition = inWar !== "cwl"
            ? (clanWarData.opponent.members.find(member => member.tag === out.player.defense.attackerTag).mapPosition)
            : (opponentClan.members.find(member => member.tag === out.player.defense.attackerTag).mapPosition);
        }
      }
      
      // clan data
      out.clan.attacks = inWar !== "cwl" ? clanWarData.clan.attacks : ourClan.attacks;
      out.clan.stars = inWar !== "cwl" ? clanWarData.clan.stars : ourClan.stars;

      // opponent clan data
      out.opponent = {
        name: inWar !== "cwl" ? clanWarData.opponent.name : opponentClan.name,
        tag: inWar !== "cwl" ? clanWarData.opponent.tag : opponentClan.tag,
        badgeUrls: inWar !== "cwl" ? clanWarData.opponent.badgeUrls : opponentClan.badgeUrls,
        attacks: inWar !== "cwl" ? clanWarData.opponent.attacks : opponentClan.attacks,
        stars: inWar !== "cwl" ? clanWarData.opponent.stars : opponentClan.stars,
      };

      // war data
      out.maxStars = inWar !== "cwl"
        ? clanWarData.teamSize * clanWarData.attacksPerMember * 3
        : CWLCurrWarData.teamSize * 3;
      out.maxAttacks = inWar !== "cwl"
        ? clanWarData.teamSize * clanWarData.attacksPerMember
        : CWLCurrWarData.teamSize;
      out.attacksPerMember = inWar !== "cwl"
        ? clanWarData.attacksPerMember
        : 1;
      out.startTime = inWar !== "cwl"
        ? clanWarData.startTime
        : CWLCurrWarData.startTime;
      out.endTime = inWar !== "cwl"
        ? clanWarData.endTime
        : CWLCurrWarData.endTime;
      if (inWar === 'cwl') {
        out.roundStatus = status;
      }
    }

    res.json(out);

  } catch (err) {
    res.status((err.response && err.response.status) || 500)
       .json({ error: err.message });
  }
});


// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
