//setup
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const app = express();
app.use(cors()); // enable CORS for all routes for now

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
    res.status((err.response?.status) || 500)
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
    let playerData = playerapi.data;

    // check if player is in a clan
    if (!playerData.clan) {
      return res.status(404).json({ error: 'Player is not in a clan.' });
    }

    // get clan tag
    const clanTag =  encodeURIComponent(playerData.clan.tag);

    // coc clan war api call
    let clanWarData;
    try {
      const clanWarapi = await axios.get(
        `https://api.clashofclans.com/v1/clans/${clanTag}/currentwar`, {
          headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
        }
      );
      clanWarData = clanWarapi.data;
    } catch (err) {
      if (err.response?.status === 403) {
        // private
        clanWarData = { state: 'private' };
      } else {
          return res.status((err.response?.status) || 500).json({ error: err.message });
      }
    }

    // coc CWL api call
    let status = []
    let CWLCurrWarData;
    let ourClan;
    let opponentClan;
    let CWLData = { state: 'notInWar' }; // default CWL data
    if (clanWarData.state === 'notInWar' || clanWarData.state === 'warEnded') {
      try {
        const CWLapi = await axios.get(
          `https://api.clashofclans.com/v1/clans/${clanTag}/currentwar/leaguegroup`, {
            headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
          }
        );
        CWLData = CWLapi.data;
        
        if (CWLData.state !== 'notInWar') {
          status = Array(CWLData.rounds.length).fill('');

          for (let i = 0; i < CWLData.rounds.length; i++) {
            for (let j = 0; j < CWLData.rounds[i].warTags.length; j++) {
              const warTag = encodeURIComponent(CWLData.rounds[i].warTags[j]);
              const CWLWarapi = await axios.get(
                `https://api.clashofclans.com/v1/clanwarleagues/wars/${warTag}`, {
                  headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` }
                }
              );
              const CWLWarData = CWLWarapi.data;
              
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
            if (CWLCurrWarData) break;
          }
        }
      } catch (err) {
        if (err.response?.status === 404) {
          CWLData = { state: 'notInWar' };
        } else {
          return res.status((err.response?.status) || 500).json({ error: err.message });
        }
      }
    }
    
    let inWar = clanWarData.state !== 'notInWar' && clanWarData.state !== 'private' ? clanWarData.state : (CWLData.state === 'inWar' ? 'cwl' : clanWarData.state);

    //grab last war
    let lastWarData = null;
    if (inWar === 'notInWar') {
      try {
        const lastWarApi = await axios.get(
          `https://api.clashofclans.com/v1/clans/${clanTag}/warlog`, {
            headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` },
            params: { limit: 1 } // get only the last war
          }
        );
        const lastWar = lastWarApi.data.items[0];
        if (lastWar && lastWar.result !== null && lastWar.endTime) {
          // Parse endTime (example format: '20250624T031048.000Z')
          const endTime = new Date(
            lastWar.endTime.replace(/(\d{8})T(\d{6})\.(\d{3})Z/,
              (m, d, t) => `${d.substr(0,4)}-${d.substr(4,2)}-${d.substr(6,2)}T${t.substr(0,2)}:${t.substr(2,2)}:${t.substr(4,2)}.000Z`)
          );
          const now = new Date();
          const diffHours = (now - endTime) / (1000 * 60 * 60);
          if (diffHours <= 24 && diffHours >= 0) {
            lastWarData = lastWar;
            clanWarData = lastWarData;
            inWar = 'warEnded';
          }
        }
      }
      catch (err) {
        if (err.response?.status !== 403) { // if 403, it means the war log is private
          return res.status((err.response?.status) || 500).json({ error: err.message });
        }
      }
    }


    // prepare data
    let out;

    // Helper to build player info for lastWarData
    function buildPlayerLastWar(playerData, lastWarData) {
      return {
        tag: playerData.tag,
        name: playerData.name,
        townHallLevel: playerData.townHallLevel,
        isParticipating: undefined, // warlog does not provide member info
        mapPosition: undefined, // warlog does not provide mapPosition
        attacks: [], // warlog does not provide detailed attacks
        defense: {} // warlog does not provide defense info
      };
    }

    // Helper to build clan info
    function buildClanInfo(clan) {
      return {
        name: clan.name,
        tag: clan.tag,
        badgeUrls: clan.badgeUrls,
        attacks: clan.attacks,
        stars: clan.stars,
        destructionPercentage: clan.destructionPercentage,
        expEarned: clan.expEarned,
        clanLevel: clan.clanLevel
      };
    }

    // Helper to build opponent info
    function buildOpponentInfo(opponent) {
      return {
        name: opponent.name,
        tag: opponent.tag,
        badgeUrls: opponent.badgeUrls,
        attacks: opponent.attacks,
        stars: opponent.stars,
        destructionPercentage: opponent.destructionPercentage,
        clanLevel: opponent.clanLevel
      };
    }

    if (lastWarData) {
      // Use lastWarData
      out = {
        inWar: 'warEnded',
        player: buildPlayerLastWar(playerData, lastWarData),
        clan: buildClanInfo(lastWarData.clan),
        opponent: buildOpponentInfo(lastWarData.opponent),
        maxStars: lastWarData.teamSize * lastWarData.attacksPerMember * 3,
        maxAttacks: lastWarData.teamSize * lastWarData.attacksPerMember,
        attacksPerMember: lastWarData.attacksPerMember,
        startTime: undefined, // warlog does not provide startTime
        endTime: lastWarData.endTime
      };
    } else {
      // Use live war or CWL data
      out = {
        inWar,
        player: {
          tag: playerData.tag,
          name: playerData.name,
          townHallLevel: playerData.townHallLevel,
          // isParticipating, mapPosition, attacks, defense added below if in war
        },
        clan: {
          name: playerData.clan.name,
          tag: playerData.clan.tag,
          badgeUrls: playerData.clan.badgeUrls, // small, medium, large
          // attacks, stars added below if in war
        },
        // opponent, maxStars, maxAttacks, etc. added below if in war
      };
    }

    // player data
    if (!lastWarData && inWar !== 'notInWar' && inWar !== 'private') {
      out.player.isParticipating = inWar !== "cwl"
        ? (clanWarData.clan.members.find(member => member.tag === playerData.tag) ? 'yes' : 'no')
        : (ourClan.members.find(member => member.tag === playerData.tag) ? 'yes' : 'no');
      out.player.mapPosition = inWar !== "cwl"
        ? (clanWarData.clan.members.find(member => member.tag === playerData.tag)?.mapPosition)
        : (ourClan.members.find(member => member.tag === playerData.tag)?.mapPosition);
      
      // attacks and defense
      if (out.player.isParticipating === 'yes') {
        // attacks
        out.player.attacks = inWar !== "cwl"
          ? (clanWarData.clan.members.find(member => member.tag === playerData.tag)?.attacks || [])
          : (ourClan.members.find(member => member.tag === playerData.tag)?.attacks || []);
        await Promise.all(
          out.player.attacks.map(async (attack) => {
            const defender = await axios.get(
              `https://api.clashofclans.com/v1/players/${encodeURIComponent(attack.defenderTag)}`,
              { headers: { Authorization: `Bearer ${process.env.COC_TOKEN}` } }
            );

            // Find previous best attack (from any clan member) on this defender, with lower order
            let allClanAttacks = [];
            if (inWar !== "cwl") {
              allClanAttacks = clanWarData.clan.members.flatMap(m => m.attacks || []);
            } else {
              allClanAttacks = ourClan.members.flatMap(m => m.attacks || []);
            }
            const prevAttacks = allClanAttacks.filter(a =>
              a.defenderTag === attack.defenderTag && a.order < attack.order
            );
            let prevBestStars = 0;
            if (prevAttacks.length > 0) {
              prevBestStars = Math.max(...prevAttacks.map(a => a.stars));
            }
            attack.newStars = attack.stars - prevBestStars > 0 ? attack.stars - prevBestStars : 0;

            attack.defenderName = defender.data.name;
            attack.defenderTownHallLevel = defender.data.townHallLevel;
            delete attack.order; // remove order
            delete attack.attackerTag; // remove attackerTag

            attack.defenderMapPosition = inWar !== "cwl"
              ? (clanWarData.opponent.members.find(member => member.tag === attack.defenderTag).mapPosition)
              : (opponentClan.members.find(member => member.tag === attack.defenderTag).mapPosition);
          })
        
        );

        // defense
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
          delete out.player.defense.order; // remove order
          delete out.player.defense.defenderTag; // remove defenderTag
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
    res.status((err.response?.status) || 500)
       .json({ error: err.message });
  }
});


// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
