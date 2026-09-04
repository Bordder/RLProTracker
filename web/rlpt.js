(function(){
  "use strict";
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});};
  var nf=function(n){return n==null?null:Number(n).toLocaleString('en-US');};
  var hf=function(n){return n==null?null:Number(n).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});};
  var initials=function(s){s=String(s||'').trim();if(!s)return'?';var p=s.split(/[\s\-_.]+/).filter(Boolean);return (p.length>1?(p[0][0]+p[1][0]):s.slice(0,2)).toUpperCase();};
  var tierClass=function(v){if(v==null)return'';if(v<1115)return't-low';if(v<1435)return't-champ';if(v<1855)return't-gc';return't-ssl';};
  var tierName=function(v){if(v==null)return'';if(v<1115)return'';if(v<1435)return'Champion';if(v<1855)return'Grand Champion';return'Supersonic Legend';};
  // `slot` distinguishes the three playlists so the phone layout can promote
  // 2v2 and demote the other two; on the desktop table it changes nothing.
  var mmrCell=function(v,slot){
    var cls='c-mmr'+(slot?' '+slot:'');
    var lab=slot==='m1'?'1v1':slot==='m3'?'3v3':'2v2';
    return v==null
      ? '<td class="'+cls+'" data-l="'+lab+'"><span class="dash">&middot;</span></td>'
      : '<td class="'+cls+'" data-l="'+lab+'"><span class="mv '+tierClass(v)+'">'+nf(v)+'</span></td>';
  };
  var WIN_LABEL={d1:'24h',d7:'7d',d14:'14d'};
  // Coarse "how long ago", for a cell that has room for about five characters.
  var agoShort=function(t){
    if(t==null)return null;
    var m=Math.round((Date.now()-t)/60000);
    if(m<0)return null;
    if(m<60)return m+'m ago';
    var h=Math.floor(m/60); if(h<24)return h+'h ago';
    var d=Math.floor(h/24); if(d<14)return d+'d ago';
    return Math.floor(d/7)+'w ago';
  };
  // A zero in a window column is true but says nothing: it cannot tell someone
  // who stopped last night from someone nobody has seen in a fortnight. Where a
  // last ranked game is known, say when it was instead - the number being
  // replaced is zero, so no information is lost.
  var fmtGames=function(p,win){
    var gs=p?p.games:null, g=gs?gs[win]:null;
    if(!g||g.games==null)return'<span class="dash">&middot;</span>';
    if(g.partial)return'<span class="pending" title="Not tracked for a full '+esc(WIN_LABEL[win]||win)+' yet">pending</span>';
    if(g.games===0){ var a=agoShort(p.lastPlayedAt); return a?'<span class="lastp">'+esc(a)+'</span>':'<span class="mv">0</span>'; }
    return'<span class="g14v">'+nf(g.games)+'</span>';
  };
  // Short chip labels, with the full meaning kept on hover.
  var STATUS_LABEL={'hidden-details':'hidden','no-steam-id':'no steam','no-steam-link':'no steam','playtime-hidden':'hours hidden','epic':'epic','pending':'checking'};
  var STATUS_HINT={
    'public':'Profile is public, so hours and games are tracked in full.',
    'hidden-details':'Game details are toggled off.',
    'private':'Profile is fully private.',
    'no-steam-id':'No Steam account matched for this player.',
    'no-steam-link':'No Steam account matched for this player.',
    'playtime-hidden':'Profile is public but keeps total playtime private.',
    'epic':'Epic Games user. Games and MMR tracked as normal.',
    'pending':'Newly added. Ranked games and MMR are already tracked; the hourly Steam check has not reached this player yet.',
    'unknown':'Steam did not return a profile state for this player.'
  };
  var statusChip=function(s){
    if(!s)return'<span class="dash">&middot;</span>';
    var k=String(s).toLowerCase(),cls='';
    if(/public|active|online|grind/.test(k))cls='sx-live';
    else if(/priv|hidden|limit/.test(k))cls='sx-priv';
    else if(/no-steam|unknown|error|none|idle|offline|pending|epic/.test(k))cls='sx-off';
    var isErr=k.indexOf('error')===0;
    var label=isErr?'steam err':(STATUS_LABEL[k]||s);
    var hint=isErr?'Steam returned an error for this player on the last check.':(STATUS_HINT[k]||'');
    return'<span class="sx '+cls+'"'+(hint?' title="'+esc(hint)+'"':'')+'>'+esc(label)+'</span>';
  };
  var rankMark=function(r){ if(!r)return'<span class="rknum">&middot;</span>'; return'<span class="rknum'+(r<=3?' t'+r:'')+'">'+String(r).padStart(2,'0')+'</span>'; };

  // Why an hours cell is empty. A bare dot reads as "no activity", which is
  // wrong: these players are often the most active on the board. Steam simply
  // is not reporting them, and the profile is re-checked every hour, so a
  // number appears on its own if the setting ever changes.
  var HOURS_NA={
    'hidden-details':{t:'hidden',h:'Game details are toggled off.'},
    'private':{t:'private',h:'Profile is fully private.'},
    'playtime-hidden':{t:'hours hidden',h:'Profile is public but keeps total playtime private.'},
    'no-steam-id':{t:'no steam',h:'No Steam account matched yet.'},
    'no-steam-link':{t:'no steam',h:'No Steam account matched yet.'},
    'epic':{t:'epic',h:'Epic Games user. Games and MMR tracked as normal.'},
    'pending':{t:'checking',h:'Newly added: the hourly Steam check has not reached this player yet.'}
  };
  var hoursNA=function(status){
    var n=HOURS_NA[String(status||'').toLowerCase()];
    if(!n)return'<span class="dash">&middot;</span>';
    return'<span class="na" title="'+esc(n.h)+'">'+esc(n.t)+'</span>';
  };

  // Total playtime, flagged when it is a stored reading from before the profile closed.
  var totalHoursCell=function(p){
    // An Epic player's Steam total is not their playtime. mtzr showed 1,173
    // hours: real enough as a Steam figure, and nothing to do with the account
    // they actually play on, so the number was simply wrong. Say "epic" instead,
    // as the other hours cells already do for this status.
    if(String(p.status||'').toLowerCase()==='epic')return hoursNA(p.status);
    if(p.totalHours==null)return hoursNA(p.status);
    var v=nf(Math.round(p.totalHours));
    if(!p.totalFrozenAt)return v;
    var d=new Date(p.totalFrozenAt);
    var on=isNaN(d)?'an earlier check':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    // Covers both routes to a frozen figure: a profile that went private, and
    // one that switched its total playtime to private. The reader only needs to
    // know when it was taken and why it has stopped moving.
    return'<span class="frozen" title="Captured '+esc(on)+'. Frozen until this profile publishes hours again.">'+v+'</span>';
  };
  // The 2-week hours cell, in order of preference: Steam's own figure, then a
  // sampled estimate, then a note saying why there is neither.
  //
  // The estimate matters most for players who own the game on Steam but launch
  // it through Epic. Their Steam playtime is permanently zero, yet their live
  // status is public, so sampling is the only way to put a number on them.
  var hours2wkCell=function(p){
    if(p.hours2wk!=null)return hf(p.hours2wk);
    if(p.estHours2wk!=null){
      return '<span class="est" title="Rough estimate from live-status checks every few minutes.">'+hf(p.estHours2wk)+'</span>';
    }
    return hoursNA(p.status);
  };

  // Region by team's RLCS competitive region (may differ from a player's nationality).
  var REGION={
    'Karmine Corp':'EU','Gentle Mates':'EU','Team Vitality':'EU','Ninjas in Pyjamas':'EU','Man City Esports':'EU',
    'NRG':'NA','Shopify Rebellion':'NA','Spacestation Gaming':'NA','Wildcard':'NA','TSM':'NA','FUT Esports':'NA','Virtus.pro':'NA',
    'MIBR':'SAM','FURIA':'SAM','Mate y Tapa':'SAM','Bigodes':'SAM',
    'Twisted Minds':'MENA','Team Falcons':'MENA','R8 Esports':'MENA',
    'Five Fears':'OCE',
    // Regional sides, tracked beyond the World Championship field.
    'Geekay Esports':'EU','Team BSK':'EU','Novo Esports':'EU','FN':'EU','GHT':'EU',
    'Gen.G Mobil1 Racing':'NA','Dignitas':'NA','M80':'NA','Lil Step Bros':'NA','S.O.S.':'NA',
    'Rafha Esports':'MENA','DOS':'MENA','Team Stallions':'MENA',
    'Pioneers':'SSA'
  };
  var REGION_CLASS={EU:'rg-eu',NA:'rg-na',SAM:'rg-sam',MENA:'rg-mena',OCE:'rg-oce',APAC:'rg-apac',SSA:'rg-ssa'};

  // ---- Team marks -------------------------------------------------------
  // Drop a file at web/img/teams/<slug>.<ext> and list its extension here to
  // use a real org logo; anything not listed falls back to a tinted monogram.
  // Slugs come from teamSlug() below, e.g. "Ninjas in Pyjamas" -> ninjas-in-pyjamas.
  // Per-logo inset override in px (default 3, set in CSS). A few marks are
  // supplied tight-cropped, with the artwork running to the edge of its own
  // file: Virtus.pro's shield fills its whole bounding box, so at the shared
  // inset it renders noticeably larger than marks that carry their own
  // whitespace. Nudging those individually keeps optical size consistent.
  // Initials people actually use for these orgs, where the first two letters of
  // the name are not it. Gentle Mates are M8, Ninjas in Pyjamas are NIP, and so
  // on. Keyed by teamSlug so a rename of the display name does not silently
  // drop the override.
  //
  // It also breaks two collisions the two-letter rule created: R8 Esports and
  // Rafha Esports both reduced to "RE", and TSM and Team Stallions both to
  // "TS". TSM's is only ever seen if its logo fails to load, which is exactly
  // when you would want it to be right.
  var TEAM_INITIALS={
    'gentle-mates':'M8', 'team-vitality':'VIT', 'ninjas-in-pyjamas':'NIP',
    'dignitas':'DIG', 'm80':'M80', 'fut-esports':'FUT', 'geekay-esports':'GK',
    'ght':'GHT', 'r8-esports':'R8', 'wildcard':'WC', 'tsm':'TSM',
    'team-bsk':'BSK', 'team-falcons':'FAL'
  };
  var LOGO_INSET={'virtuspro':6};
  var TEAM_LOGO={'geng-mobil1-racing':'png','karmine-corp':'png','lil-step-bros':'png','mibr':'png','nrg':'png','shopify-rebellion':'png','spacestation-gaming':'png','tsm':'png'};
  var LOGO_DIR='img/teams/';

  var teamSlug=function(name){
    return String(name||'').toLowerCase()
      .replace(/[’'".]/g,'')
      .replace(/[^a-z0-9]+/g,'-')
      .replace(/^-+|-+$/g,'');
  };
  // Hues are spread evenly across the roster rather than hashed: with ~20 orgs a
  // hash puts several within a few degrees of each other and they read as the
  // same colour. Assigned over the sorted team list, so it is stable per season.
  var TEAM_HUE={};
  var assignTeamHues=function(names){
    var uniq=names.filter(function(n){return n;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
    uniq.forEach(function(n,i){ TEAM_HUE[n]=Math.round(i*360/uniq.length); });
  };
  var teamHue=function(name){ return TEAM_HUE[name]!=null?TEAM_HUE[name]:0; };
  var teamMark=function(name,extraClass){
    var cls='av '+(extraClass||'')+' mk';
    var h=teamHue(name);
    var style='--mk:hsl('+h+' 42% 17%);--mkfg:hsl('+h+' 70% 68%);--mkline:hsl('+h+' 45% 32%)';
    var slug=teamSlug(name), ext=TEAM_LOGO[slug];
    var mono=TEAM_INITIALS[slug]||initials(name);
    // The monogram is always rendered; a logo, when there is one, covers it.
    return '<span class="'+cls+(ext?' logo':'')+(mono.length>3?' mk4':mono.length>2?' mk3':'')+'" style="'+style+'" aria-hidden="true">'+esc(mono)+
      (ext?'<img src="'+esc(LOGO_DIR+slug+'.'+ext)+'" alt="" loading="lazy" decoding="async"'+
        (LOGO_INSET[slug]?' style="padding:'+LOGO_INSET[slug]+'px"':'')+'>':'')+'</span>';
  };
  var regionChip=function(r){ return r?'<span class="rg '+(REGION_CLASS[r]||'')+'">'+esc(r)+'</span>':'<span class="dash">&middot;</span>'; };

  var DATA_BASE=window.__DATA_BASE__||"/data";
  // Busting on a 60s bucket keeps a tab from sitting on a stale copy: the
  // collector writes every ~2 minutes, so a minute is fine enough to matter and
  // coarse enough that repeat visits within the same minute still hit a cache.
  // The query string only affects the browser and our own origin; the Function
  // behind /data collapses the upstream read separately.
  var getJson=function(f){
    var bust='?v='+Math.floor(Date.now()/60000);
    return fetch(DATA_BASE+'/'+f+bust,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});
  };
  var load=window.__RLDATA__
    ? Promise.resolve([window.__RLDATA__.steam,window.__RLDATA__.teams,window.__RLDATA__.tracker,window.__RLDATA__.teamTracker,window.__RLDATA__.presence])
    : Promise.all([getJson('steam-hours.json'),getJson('team-hours.json'),getJson('tracker.json'),getJson('team-tracker.json'),getJson('presence-hours.json')]);

  load.then(function(res){
    // ---- rank by 2v2 MMR (players by their twos, teams by avg twos) ----
    var assignRank=function(arr,key){ arr.filter(function(x){return key(x)!=null;}).sort(function(a,b){return key(b)-key(a);}).forEach(function(x,i){x.__rank=i+1;}); };

    // ---- who is on the ladder right now -------------------------------------
    //
    // A player counts as live when their match count moved within LIVE_MS of
    // the data being collected, and that collection is itself recent. Both
    // halves matter: without the second, a stalled collector would keep
    // insisting a session from an hour ago is still running.
    var LIVE_MS=10*60e3;
    var isLive=function(p){
      if(!p.lastPlayedAt||collectedAt==null)return false;
      if(Date.now()-collectedAt>LIVE_MS)return false;
      return collectedAt-p.lastPlayedAt<=LIVE_MS;
    };
    var sessionMins=function(p){
      if(!p.session||collectedAt==null)return null;
      return Math.max(1,Math.round((collectedAt-p.session.startedAt)/60000));
    };
    var durWords=function(m){ return m<60?m+'m':(Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'); };

    // ---- stat cards (Grind dashboard summary) ----
    var card=function(k,v,s2,hot){return '<div class="card'+(hot?' hot':'')+'"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="s">'+s2+'</div></div>';};
    function renderCards(){
      var ranked=players.filter(function(p){return p.hasMmr;});
      var totalGames=players.reduce(function(a,p){return a+(p.seasonGames||0);},0);
      var top=players.filter(function(p){return p.seasonGames!=null;}).sort(function(a,b){return b.seasonGames-a.seasonGames;})[0];
      // "60 / 60" is a fraction whose halves are the same number; it only earns
      // the denominator when somebody is missing.
      var rankedFig=ranked.length===players.length
        ? String(ranked.length)
        : ranked.length+' <small>/ '+players.length+'</small>';
      // Four tiles in one row. The average 2v2 MMR used to sit third and was
      // dropped: an average across a field this narrow barely moves, so it was
      // the one number on the page that never told anyone anything. The season
      // leader takes its slot, which also puts four tiles in a row that divides
      // evenly instead of five that never can.
      document.getElementById('stats').innerHTML=
        card('Players Ranked', rankedFig, 'pros with ranked data', false)+
        card('Total Ranked Games', nf(totalGames), 'across all tracked pros', false)+
        card('Most Active Pro', top?(nf(top.seasonGames)+' <small>games</small>'):'&middot;', top?('<b>'+esc(top.name)+'</b> &middot; '+esc(top.team||'')):'no data yet', false)+
        // Which roster is on the ladder today, rather than an inventory of how
        // many orgs the board covers. The teams tab is a click away for that.
        topTeamCard();
    }

    // Ranked on the season total, not the last 24 hours: the 24h figure it used
    // to show was a bare "128 games" with nothing saying over what, and the
    // obvious reading was the wrong one. Both season cards are ranked the same
    // way and sit side by side, so neither repeats the window.
    //
    // It is the sum across a team's tracked players, so a team with fewer of
    // them tracked is at a disadvantage. Most carry three.
    function topTeamCard(){
      var withGames=teams.filter(function(t){return t.seasonGames!=null;});
      if(!withGames.length)return '';
      var top=withGames.slice().sort(function(a,b){return b.seasonGames-a.seasonGames;})[0];
      return card('Most Active Team', nf(top.seasonGames)+' <small>games</small>', '<b>'+esc(top.team)+'</b>', false);
    }

    // ---- merge into unified models ----
    //
    // players and teams are filled IN PLACE rather than reassigned. buildTable
    // closes over these arrays and its paint() re-reads them, so refilling and
    // repainting updates the board without rebuilding the table or rebinding a
    // single listener - which is what lets new data arrive without a reload,
    // keeping the visitor's sort, search and scroll position.
    var players=[], teams=[];
    var collectedAt=null, serverAt=null;

    function hydrate(res){
      var steam=res[0], teamH=res[1], tracker=res[2], teamT=res[3], presence=res[4];
      if(!steam||!teamH)return false;

      var trById={}; (tracker&&tracker.players||[]).forEach(function(p){trById[p.id]=p;});
      // Presence hours are only ever a fallback. Where Steam publishes playtime
      // we use that; where it does not, polling who is in-game reconstructs a
      // rough figure. d14 matches the 2-week window the Steam column shows.
      var presById={}; (presence&&presence.players||[]).forEach(function(p){presById[p.id]=p;});

      // The board is every player either collector knows about, not just the
      // ones Steam has seen. The two run on different clocks - Steam hourly,
      // the tracker every couple of minutes - so a player added to the roster
      // would otherwise be missing from the site for up to an hour despite
      // having MMR and games already.
      var steamById={}; steam.players.forEach(function(p){steamById[p.id]=p;});
      var ids=steam.players.map(function(p){return p.id;});
      (tracker&&tracker.players||[]).forEach(function(p){ if(!steamById[p.id])ids.push(p.id); });

      var nextPlayers=ids.map(function(id){
        var p=steamById[id]||trById[id]||{};
        var t=trById[id]||{};
        return { id:id, name:p.name, team:p.team, region:REGION[p.team]||null,
          // Not 'unknown', which means Steam answered oddly. This player has
          // simply not been through the hourly Steam job yet.
          status:steamById[id]?steamById[id].status:'pending',
          mmr:(t.mmr&&t.mmr.twos!=null)?t.mmr:(t.mmr||null),
          hasMmr:!!(t.mmr&&(t.mmr.ones!=null||t.mmr.twos!=null||t.mmr.threes!=null)),
          seasonGames:t.seasonGames?t.seasonGames.total:null,
          games:t.games?t.games.total:null,
          updatedAt:(function(){var v=t.updatedAt?Date.parse(t.updatedAt):NaN;return isNaN(v)?null:v;})(),
          // Derived from cumulative match counts, so it covers every player
          // rather than only the profiles Steam lets us watch.
          lastPlayedAt:(function(){var v=t.lastPlayedAt?Date.parse(t.lastPlayedAt):NaN;return isNaN(v)?null:v;})(),
          session:t.session?{startedAt:Date.parse(t.session.startedAt),games:t.session.games}:null,
          // Hours only ever come from the Steam side; a player the hourly job
          // has not reached yet simply has none, which the cells already know
          // how to say.
          hours2wk:p.steam2wkHours!=null?p.steam2wkHours:null,
          estHours2wk:(function(){
            if(p.steam2wkHours!=null)return null; // never shadow a measured reading
            var e=presById[id];
            return (e&&e.presenceHours&&e.presenceHours.d14)?e.presenceHours.d14:null;
          })(),
          totalHours:p.totalHours!=null?p.totalHours:null, totalFrozenAt:p.totalHoursFrozenAt||null };
      });

      // Same union on the teams tab: team-hours comes from the hourly Steam job
      // and team-tracker from the two-minute one, so a new org would otherwise
      // be missing here too.
      var ttByTeam={}; (teamT&&teamT.teams||[]).forEach(function(t){ttByTeam[t.team]=t;});
      var thByTeam={}; teamH.teams.forEach(function(t){thByTeam[t.team]=t;});
      var teamNames=teamH.teams.map(function(t){return t.team;});
      (teamT&&teamT.teams||[]).forEach(function(t){ if(!thByTeam[t.team])teamNames.push(t.team); });

      var nextTeams=teamNames.map(function(name){
        var t=thByTeam[name]||{team:name,players:(ttByTeam[name]||{}).players||0,tracked:0,steam2wkHours:null,totalHours:null};
        var tt=ttByTeam[name]||{};
        return { team:t.team, region:REGION[t.team]||null, players:t.players, tracked:t.tracked, ranked:tt.ranked||0,
          avgMmr:tt.avgMmr||null, seasonGames:tt.seasonGames!=null?tt.seasonGames:null, games:tt.games||null,
          hours2wk:t.steam2wkHours, totalHours:t.totalHours };
      });

      players.length=0; Array.prototype.push.apply(players,nextPlayers);
      teams.length=0;   Array.prototype.push.apply(teams,nextTeams);

      // Re-derive on every update, not just at load: a roster change can add a
      // team while the page is open, and without this it would render with the
      // default hue until someone reloaded.
      assignTeamHues(teams.map(function(t){return t.team;}).concat(players.map(function(p){return p.team;})));

      assignRank(players,function(p){return p.mmr?p.mmr.twos:null;});
      assignRank(teams,function(t){return t.avgMmr?t.avgMmr.twos:null;});

      var iso=(tracker&&tracker.computedAt)||steam.computedAt;
      var d=iso?Date.parse(iso):NaN;
      collectedAt=isNaN(d)?null:d;
      if(collectedAt!=null&&(serverAt==null||collectedAt>serverAt))serverAt=collectedAt;

      // Cards read live state, and live state is judged against the collection
      // time, so this has to come after that timestamp is in place.
      renderCards();
      if(typeof buildRegions==='function'){ buildRegions(); buildPlaying(); }
      return true;
    }

    if(!hydrate(res)){ document.getElementById('playersView').innerHTML='<div class="scroll"><div class="empty">Failed to load data</div></div>'; return; }

    // A logo that fails to load drops back to the monogram underneath it.
    // Capture phase: img error events do not bubble.
    document.addEventListener('error',function(e){
      var img=e.target;
      if(img&&img.tagName==='IMG'&&img.parentNode&&img.parentNode.classList.contains('logo')){
        img.parentNode.classList.remove('logo');
        img.parentNode.removeChild(img);
      }
    },true);

    // ---- updated + footnote ----
    // ---- collection status -------------------------------------------------
    //
    // The site's whole claim is that these numbers are recent, so serving old
    // ones silently is the worst thing it can do. Collectors run every few
    // minutes; the thresholds below are loose enough that a couple of missed
    // runs stay quiet, and tight enough that a real outage is obvious.
    // Calibrated to the collection cycle: at 2 minutes, 15 minutes of silence
    // is seven missed runs, so the page would keep insisting it was healthy
    // long after collection had died.
    var LATE_MS=8*60e3, HALTED_MS=30*60e3;

    var ageWords=function(ms){
      var m=Math.round(ms/60000);
      if(m<60)return m+' minute'+(m===1?'':'s');
      var h=Math.round(m/60);
      if(h<24)return h+' hour'+(h===1?'':'s');
      var d=Math.round(h/24);
      return d+' day'+(d===1?'':'s');
    };


    // In the row where the Steam privacy chip would sit: this player is on the
    // ladder right now, and for how long. It replaces that chip rather than
    // crowding in beside it, because while someone is playing that is the more
    // useful of the two facts.
    // Playing is not a privacy setting, so it does not stand in for one. It
    // rides the name instead, leaving the status column to say what Steam
    // publishes about that profile whether they are on the ladder or not.
    var playMark=function(p){
      var m=sessionMins(p), g=p.session?p.session.games:null;
      var hint='Playing ranked right now'+(m!=null?', '+durWords(m)+' into the session':'')+(g!=null?', '+g+(g===1?' game':' games')+' so far':'')+'.';
      return '<span class="pmark" title="'+esc(hint)+'">Playing</span>';
    };

    var renderStatus=function(){
      var meta=document.querySelector('.kick-meta');
      var dot=document.querySelector('.live-dot');
      var box=document.getElementById('dataStatus');
      if(!meta||!box)return;

      if(collectedAt==null){
        document.getElementById('updated').textContent='live';
        return;
      }
      var when=new Date(collectedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      document.getElementById('updated').textContent='updated '+when;

      // Two different problems, and telling a visitor the wrong one is worse
      // than saying nothing. If the server has newer data than this tab holds,
      // collection is healthy and the page is simply out of date - offer a
      // refresh. Only when the SERVER's own data has gone cold is something
      // actually broken.
      var pageBehind = serverAt!=null && collectedAt!=null && serverAt>collectedAt+60e3;
      var age = Date.now() - (serverAt!=null ? Math.max(serverAt,collectedAt) : collectedAt);
      var state = pageBehind ? 'behind' : (age>=HALTED_MS ? 'halted' : (age>=LATE_MS ? 'late' : 'ok'));

      meta.classList.toggle('is-late',state==='late');
      meta.classList.toggle('is-halted',state==='halted');
      if(dot){ dot.classList.toggle('is-late',state==='late'); dot.classList.toggle('is-halted',state==='halted'); }

      if(state==='ok'){ box.innerHTML=''; return; }
      if(state==='behind'){
        // Transient: refreshData() is already fetching. Say nothing rather than
        // asking the reader to do something the page is about to do itself.
        box.innerHTML='';
        return;
      }
      var aged=ageWords(age);
      box.innerHTML = state==='late'
        ? '<div class="dstatus late"><span aria-hidden="true">&#9888;</span><span><b>Collection is running behind.</b> These numbers were last refreshed '+esc(aged)+' ago, so recent games may be missing.</span></div>'
        : '<div class="dstatus halted"><span aria-hidden="true">&#9888;</span><span><b>These numbers are not being updated.</b> Nothing here has refreshed for '+esc(aged)+'. Treat every figure on this page as out of date until it recovers.</span></div>';
    };

    // Ask the server what it has, rather than assuming this tab is current.
    // A few bytes every couple of minutes; on failure we simply keep the last
    // answer and fall back to judging by age alone.
    // Refetch and repaint in place. The tables are rebuilt from the same arrays
    // buildTable already closes over, so sort order, search text, the active tab
    // and scroll position all survive - no reload, nothing moves under the
    // reader except the numbers themselves.
    // The five feeds do not move at the same rate. Ranked stats and the team
    // aggregates built from them change every 2 minutes; Steam playtime is
    // collected hourly and presence every 5, so pulling all five on every
    // refresh spends most of its bytes re-downloading identical files. The
    // slow three are refetched on their own schedule and otherwise reused from
    // the last successful load.
    var SLOW_MS=5*60e3;
    var lastFull=Date.now();
    var latest=res.slice();
    var refreshing=false;
    var refreshData=function(){
      if(refreshing)return;
      refreshing=true;
      var full=Date.now()-lastFull>=SLOW_MS;
      var keep=function(i){ return Promise.resolve(latest[i]); };
      Promise.all([
        full?getJson('steam-hours.json'):keep(0),
        full?getJson('team-hours.json'):keep(1),
        getJson('tracker.json'),
        getJson('team-tracker.json'),
        full?getJson('presence-hours.json'):keep(4)
      ])
        .then(function(next){
          // A failed fetch yields null, which hydrate rejects wholesale. Keep
          // the previous copy for any feed that did not come back rather than
          // discarding a good board over one bad response.
          for(var i=0;i<next.length;i++) if(!next[i]) next[i]=latest[i];
          if(hydrate(next)){ latest=next; if(full)lastFull=Date.now(); renderPodium(); paintP(); paintT(); restoreOpenTeam(); }
        })
        .catch(function(){})
        .then(function(){ refreshing=false; renderStatus(); });
    };

    // Ask the server what it has, rather than assuming this tab is current. A
    // few bytes every couple of minutes; only pull the full data when the
    // timestamp has actually moved. On failure keep the last answer and fall
    // back to judging by age alone.
    var pollStatus=function(){
      fetch('/api/status',{cache:'no-store'})
        .then(function(r){return r.ok?r.json():null;})
        .then(function(j){
          if(!j||!j.computedAt)return;
          var t=Date.parse(j.computedAt);
          if(isNaN(t))return;
          serverAt=t;
          if(collectedAt==null||t>collectedAt+20e3){ refreshData(); return; }
          renderStatus();
        })
        .catch(function(){});
    };

    renderStatus();
    // A live session goes stale on its own, so re-check on the same beat as the
    // freshness line rather than waiting for the next fetch.
    setInterval(function(){ renderCards(); buildPlaying(); renderPodium(); paintP(); },60000);
    // A tab left open must not keep claiming the data is fresh.
    setInterval(renderStatus,60000);

    // ---- sortable + searchable feed ----
    var pv=document.getElementById('playersView'), tv=document.getElementById('teamsView');
    var searchQ='';
  var regionQ='';   // '' = every region
  var liveOnly=false;
  var podiumIds={};  // whoever is shown large above the table

    function buildTable(mount, columns, items, accessors, rowFn, def, matchFn){
      var sk=def.k, sd=def.dir;
      var scroll=document.createElement('div'); scroll.className='scroll';
      var tbl=document.createElement('table'); tbl.className='feed';
      var thead=document.createElement('thead'), trh=document.createElement('tr');
      columns.forEach(function(c){
        var th=document.createElement('th');
        th.className=(c.cls||'')+(c.num?' num':'')+(c.k?' sortable':'');
        if(c.title)th.title=c.title;
        th.innerHTML='<span>'+c.label+'</span>'+(c.k?'<span class="ind"></span>':'');
        if(c.k){ th.tabIndex=0; th.dataset.k=c.k;
          var act=function(){ if(sk===c.k){sd=(sd==='desc'?'asc':'desc');}else{sk=c.k;sd=c.num?'desc':'asc';} paint(); };
          th.addEventListener('click',act);
          th.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}});
        }
        trh.appendChild(th);
      });
      thead.appendChild(trh); tbl.appendChild(thead);
      var tb=document.createElement('tbody'); tbl.appendChild(tb);
      function paint(){
        var arr=items.filter(function(x){
          if(regionQ&&x.region!==regionQ)return false;
          // Nobody appears twice: the three on the podium are not repeated in
          // the table underneath it.
          if(x.id&&podiumIds[x.id])return false;
          if(liveOnly&&!isLive(x))return false;
          return !searchQ||matchFn(x,searchQ);
        });
        var acc=accessors[sk];
        if(acc){ arr=arr.slice().sort(function(a,b){
          var av=acc(a),bv=acc(b),an=(av==null||av===''),bn=(bv==null||bv==='');
          if(an&&bn)return 0; if(an)return 1; if(bn)return -1;
          if(typeof av==='string')return sd==='asc'?av.localeCompare(bv):bv.localeCompare(av);
          return sd==='asc'?(av-bv):(bv-av);
        }); }
        // A search with no hits renders nothing at all: the absence is the
        // answer, and a "No matches" bar reads like something went wrong.
        // Position in the current order, not a fixed MMR rank: ordering by games
        // and then reading a 2v2 placing in the same column made the podium and
        // the list contradict each other. The offset accounts for whoever the
        // podium has taken off the top of this list.
        var off=(typeof paint.offset==="function")?paint.offset():0;
        arr.forEach(function(x,i){ x.__pos=i+1+off; });
        tb.innerHTML=arr.length?arr.map(rowFn).join(''):'';
        // The phone list shows the ordered figure beside the name, and CSS can
        // only pick that cell if the table says which one it is.
        tbl.dataset.sort=sk;
        trh.querySelectorAll('th').forEach(function(th){ th.classList.remove('s-asc','s-desc'); if(th.dataset.k===sk)th.classList.add(sd==='asc'?'s-asc':'s-desc'); });
      }
      scroll.appendChild(tbl); mount.innerHTML=''; mount.appendChild(scroll);
      // The metric buttons drive the same sort the column headers do, so the
      // two controls can never disagree about what the table is ordered by.
      paint.setSort=function(k,dir){ sk=k; sd=dir||'desc'; paint(); };
      paint.sortKey=function(){ return sk; };
      paint.sortDir=function(){ return sd; };
      paint();
      return paint;
    }

    var win='d1'; // recent-games window: d1 (24h, live now) / d7 / d14
    var mmrKey='twos'; // which playlist the MMR mode ranks on: ones / twos / threes
    var pCols=[{label:'#',cls:'c-rk'},{label:'Player',cls:'c-who',k:'name'},{label:'Region',cls:'c-rg',k:'region'},{label:'Status',cls:'c-st',k:'status'},{label:'1v1',cls:'c-mmr',k:'ones',num:true},{label:'2v2',cls:'c-mmr',k:'twos',num:true},{label:'3v3',cls:'c-mmr',k:'threes',num:true},{label:'Games',cls:'c-sg',k:'sg',num:true,title:'Total ranked games played since the current competitive season began'},{label:WIN_LABEL[win],cls:'c-g14',k:'g14',num:true},{label:'2wk h',cls:'c-hr',k:'h2',num:true},{label:'Total h',cls:'c-hr',k:'ht',num:true}];
    var pAcc={name:function(p){return(p.name||'').toLowerCase();},region:function(p){return p.region||null;},status:function(p){return p.status?String(p.status).toLowerCase():null;},ones:function(p){return p.mmr?p.mmr.ones:null;},twos:function(p){return p.mmr?p.mmr.twos:null;},threes:function(p){return p.mmr?p.mmr.threes:null;},sg:function(p){return p.seasonGames;},g14:function(p){
        // "pending" in the cell means the window has not filled yet, so there is
        // nothing to rank: a new player's first reading is their whole season,
        // which would otherwise put them top of a 24h ordering.
        var g=p.games&&p.games[win];
        return g&&g.games!=null&&!g.partial?g.games:null;
      },h2:function(p){return p.hours2wk!=null?p.hours2wk:p.estHours2wk;},ht:function(p){return p.totalHours;}};
    var playerRow=function(p){
      var mmr=p.hasMmr?(mmrCell(p.mmr.ones,'m1')+mmrCell(p.mmr.twos,'m2')+mmrCell(p.mmr.threes,'m3')):'<td class="c-mmr norank" colspan="3">no ranked data</td>';
      return '<tr class="'+(p.hasMmr?'':'isnorank')+'" data-player="'+esc(p.name)+'">'+
        '<td class="c-rk">'+rankMark(p.__pos||p.__rank)+'</td>'+
        '<td class="c-who">'+teamMark(p.team)+'<span class="nm"><b>'+esc(p.name)+(isLive(p)?playMark(p):'')+'</b><i>'+esc(p.team||'Free agent')+'</i></span></td>'+
        // The phone layout needs both chips in one container so they can sit
        // flush against the right edge together; as separate grid cells they
        // could be adjacent or right aligned, never both. The duplicate is
        // hidden on desktop, where the two columns stay sortable in their own
        // right.
        '<td class="c-rg">'+regionChip(p.region)+'<span class="chip-pair">'+statusChip(p.status)+'</span></td>'+
        '<td class="c-st">'+statusChip(p.status)+'</td>'+mmr+
        '<td class="c-sg" data-l="games">'+(p.seasonGames!=null?'<span class="sgv">'+nf(p.seasonGames)+'</span>':'<span class="dash">&middot;</span>')+'</td>'+
        '<td class="c-g14" data-l="'+esc(WIN_LABEL[win]||win)+'">'+fmtGames(p,win)+'</td>'+
        '<td class="c-hr c-hr2" data-l="2wk h">'+hours2wkCell(p)+'</td>'+
        '<td class="c-hr c-hrt" data-l="total h">'+totalHoursCell(p)+'</td>'+
        '</tr>';
    };
    var pMatch=function(p,q){return (String(p.name||'')+' '+String(p.team||'')+' '+String(p.region||'')).toLowerCase().indexOf(q)>=0;};

    var tCols=[{label:'#',cls:'c-rk'},{label:'Team',cls:'c-who',k:'name'},{label:'Region',cls:'c-rg',k:'region'},{label:'',cls:'c-fill'},{label:'Avg 1v1',cls:'c-mmr',k:'ones',num:true},{label:'Avg 2v2',cls:'c-mmr',k:'twos',num:true},{label:'Avg 3v3',cls:'c-mmr',k:'threes',num:true},{label:'Games',cls:'c-sg',k:'sg',num:true,title:'Total ranked games played by the roster since the current competitive season began'},{label:'2wk h',cls:'c-hr',k:'h2',num:true},{label:'Total h',cls:'c-hr',k:'ht',num:true}];
    var tAcc={name:function(t){return(t.team||'').toLowerCase();},region:function(t){return t.region||null;},ones:function(t){return t.avgMmr?t.avgMmr.ones:null;},twos:function(t){return t.avgMmr?t.avgMmr.twos:null;},threes:function(t){return t.avgMmr?t.avgMmr.threes:null;},sg:function(t){return t.seasonGames;},h2:function(t){return t.hours2wk;},ht:function(t){return t.totalHours;}};
    // Team totals only sum the players who publish hours. Printing 0 for a team
  // where nobody does reads as "this team never plays", and a partial sum needs
  // saying so or it looks like the whole roster.
  var teamHoursCell=function(t,v,fmt){
    if(!t.tracked)return'<span class="na" title="Every player on this team keeps their hours private, so there is nothing to add up.">hidden</span>';
    if(v==null)return'<span class="dash">&middot;</span>';
    var body=fmt(v);
    if(t.tracked<t.players)return'<span class="part" title="'+t.tracked+' of '+t.players+' players publish hours; the rest keep them private.">'+body+'</span>';
    return body;
  };

  var teamRow=function(t){
      var a=t.avgMmr||{};
      return '<tr class="team-row '+(t.ranked?'':'isnorank')+'" data-team="'+esc(t.team)+'" tabindex="0" aria-expanded="false">'+
        '<td class="c-rk">'+rankMark(t.__pos||t.__rank)+'</td>'+
        '<td class="c-who">'+teamMark(t.team,'tm')+'<span class="nm"><b>'+esc(t.team)+'</b></span></td>'+
        '<td class="c-rg">'+regionChip(t.region)+'</td>'+
        '<td class="c-fill"></td>'+
        mmrCell(a.ones,'m1')+mmrCell(a.twos,'m2')+mmrCell(a.threes,'m3')+
        '<td class="c-sg" data-l="season">'+(t.seasonGames!=null?'<span class="sgv">'+nf(t.seasonGames)+'</span>':'<span class="dash">&middot;</span>')+'</td>'+
        '<td class="c-hr c-hr2" data-l="2wk h">'+teamHoursCell(t,t.hours2wk,hf)+'</td>'+
        '<td class="c-hr c-hrt" data-l="total h">'+teamHoursCell(t,t.totalHours,function(x){return nf(Math.round(x));})+'</td></tr>';
    };
    var tMatch=function(t,q){return (String(t.team||'')+' '+String(t.region||'')).toLowerCase().indexOf(q)>=0;};

    // Roster-comparison panel for a team (players side by side, best per row highlighted).
    var byTeam={}; players.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });
    var teamPanel=function(name){
      var roster=(byTeam[name]||[]).slice();
      if(!roster.length)return '<div class="exp-wrap"><div class="exp-h">No player data yet</div></div>';
      roster.sort(function(a,b){return (b.mmr&&b.mmr.twos||0)-(a.mmr&&a.mmr.twos||0);});
      // Columns mirror the main player table so the panel reads the same way.
      // Same value styling as the main table: tier colours on MMR, accent on games.
      var mmrSpan=function(v){return '<span class="mv '+tierClass(v)+'">'+nf(v)+'</span>';};
      var METRICS=[
        {label:'1v1',val:function(p){return p.mmr?p.mmr.ones:null;},fmt:mmrSpan},
        {label:'2v2',val:function(p){return p.mmr?p.mmr.twos:null;},fmt:mmrSpan},
        {label:'3v3',val:function(p){return p.mmr?p.mmr.threes:null;},fmt:mmrSpan},
        {label:'Games',val:function(p){return p.seasonGames;},fmt:function(v){return '<span class="sgv">'+nf(v)+'</span>';}},
        // Fixed at 24h rather than following the main table's window toggle:
        // that control belongs to the players view and is hidden behind this
        // panel, so a label here that could silently mean 7d would mislead.
        {label:WIN_LABEL.d1,val:function(p){
          var g=p.games?p.games.d1:null;
          // A partial window is not a low number, it is no number yet.
          return (g&&g.games!=null&&!g.partial)?g.games:null;
        },fmt:function(v){return '<span class="g14v">'+nf(v)+'</span>';},
        na:function(p){
          var g=p.games?p.games.d1:null;
          if(g&&g.partial)return'<span class="pending" title="Not tracked for a full 24h yet">pending</span>';
          var a=agoShort(p.lastPlayedAt);
          return a?'<span class="lastp">'+esc(a)+'</span>':'<span class="dash">&middot;</span>';
        }},
        // Same order of preference as the main table: measured Steam hours,
        // then the sampled estimate, marked so the two are never confused.
        {label:'2wk h',val:function(p){return p.hours2wk!=null?p.hours2wk:p.estHours2wk;},fmt:function(v,p){
          var body=hf(v);
          return p.hours2wk!=null
            ? '<span class="c-hr" style="display:inline">'+body+'</span>'
            : '<span class="est" title="Rough estimate from live-status checks every few minutes.">'+body+'</span>';
        },na:function(p){return hoursNA(p.status);}},
        {label:'Total h',val:function(p){return p.totalHours!=null?Math.round(p.totalHours):null;},fmt:function(v){return '<span class="c-hr" style="display:inline">'+nf(v)+'</span>';},na:function(p){return hoursNA(p.status);}}
      ];
      // Best value per column, so each metric highlights its leader.
      var bests=METRICS.map(function(m){ var b=null; roster.forEach(function(p){ var v=m.val(p); if(v!=null&&(b==null||v>b))b=v; }); return b; });
      var head='<tr><th class="pl">Player</th>'+METRICS.map(function(m){return '<th>'+m.label+'</th>';}).join('')+'</tr>';
      var body=roster.map(function(p){
        return '<tr><td class="pl">'+esc(p.name)+'</td>'+METRICS.map(function(m,i){
          var v=m.val(p);
          // An empty cell says "no activity", which is wrong for a player who
          // simply keeps their profile shut. Each metric explains its own blank.
          var body=v!=null?m.fmt(v,p):(m.na?m.na(p):'<span class="dash">&middot;</span>');
          return '<td'+(v!=null&&v===bests[i]?' class="best"':'')+'>'+body+'</td>';
        }).join('')+'</tr>';
      }).join('');
      return '<div class="exp-wrap"><div class="exp-h">Roster comparison</div><div class="scroll" style="border-radius:8px"><table class="mini"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></div>';
    };

    var paintPRaw=buildTable(pv,pCols,players,pAcc,playerRow,{k:'twos',dir:'desc'},pMatch);
    // The podium shows the first three, so the table starts at four.
    paintPRaw.offset=function(){ return Object.keys(podiumIds).length; };
    var paintP=function(){ paintPRaw(); if(typeof applyOpenPlayer==='function')applyOpenPlayer(); };
    paintP.setSort=function(k,dir){ paintPRaw.setSort(k,dir); if(typeof applyOpenPlayer==='function')applyOpenPlayer(); };
    paintP.sortKey=paintPRaw.sortKey;
    paintP.sortDir=paintPRaw.sortDir;
    var paintT=buildTable(tv,tCols,teams,tAcc,teamRow,{k:'twos',dir:'desc'},tMatch);

    // ---- podium ----
    //
    // The top three of whatever the table is currently ranked by, big enough to
    // read from across the room. It follows the rank-by buttons and the region
    // filter, so it is always the head of the list below it rather than a
    // second, competing ranking.
    var podEl=document.getElementById('podium');
    var METRIC_LABEL={twos:'2v2 MMR',ones:'1v1 MMR',threes:'3v3 MMR',sg:'games',g14:'games',h2:'hours, 2wk',ht:'hours total',name:'',region:'',status:''};
    // Every podium card carries the same six figures the table columns do, so
    // reading across the top three is the same job as reading down the list.
    var POD_STATS=[
      {k:'ones',  lab:'1v1',    get:function(p){ return p.mmr&&p.mmr.ones!=null?nf(p.mmr.ones):null; }},
      {k:'twos',  lab:'2v2',    get:function(p){ return p.mmr&&p.mmr.twos!=null?nf(p.mmr.twos):null; }},
      {k:'threes',lab:'3v3',    get:function(p){ return p.mmr&&p.mmr.threes!=null?nf(p.mmr.threes):null; }},
      {k:'sg',    lab:'games', get:function(p){ return p.seasonGames!=null?nf(p.seasonGames):null; }},
      {k:'g14',   lab:null, na:'pending', get:function(p){ var g=p.games&&p.games[win]; return g&&g.games!=null&&!g.partial?nf(g.games):null; }},
      // A second window beside the one the board is ranked by, so a card says
      // whether today is a burst or a habit. It is 7d normally, and 24h when
      // the board is already showing 7d, which keeps the row six cells wide
      // whatever the ranking and never prints the same window twice.
      {k:'g2nd',  lab:null, na:'pending', get:function(p){ var w=(win==='d7'?'d1':'d7'); var g=p.games&&p.games[w]; return g&&g.games!=null&&!g.partial?nf(g.games):null; }},
      {k:'h2',    lab:'2wk h',  get:function(p){ var h=p.hours2wk!=null?p.hours2wk:p.estHours2wk; return h!=null?(p.hours2wk!=null?hf(h):'~'+hf(h)):null; }}
    ];
    var podFigure=function(p,k){
      if(k==='g14'){ var g=p.games&&p.games[win]; return g&&g.games!=null&&!g.partial?nf(g.games):null; }
      if(k==='h2'){ var h=p.hours2wk!=null?p.hours2wk:p.estHours2wk; return h!=null?hf(h):null; }
      if(k==='ht') return p.totalHours!=null?nf(Math.round(p.totalHours)):null;
      if(k==='sg') return p.seasonGames!=null?nf(p.seasonGames):null;
      var v=p.mmr?p.mmr[k]:null; return v!=null?nf(v):null;
    };
    var podStat=function(label,value,active,na){
      return '<div'+(active?' class="on"':'')+'><b'+(value==null?' class="na"':'')+'>'+(value==null?(na||'hidden'):value)+'</b><span>'+label+'</span></div>';
    };
    // `nextKey` lets a caller render the podium for an order it is about to
    // apply, rather than the one the table is still in.
    var renderPodium=function(nextKey){
      if(!podEl)return;
      var k=nextKey||paintP.sortKey(), acc=pAcc[k];
      // Ranking by name or region is a lookup, not a leaderboard, so no podium.
      if(!acc||k==='name'||k==='region'||k==='status'||searchQ){ podEl.innerHTML=''; podiumIds={}; return; }
      var arr=players.filter(function(p){
        if(regionQ&&p.region!==regionQ)return false;
        return !liveOnly||isLive(p);
      });
      var dir=paintP.sortDir();
      arr=arr.slice().sort(function(a,b){
        var av=acc(a),bv=acc(b),an=(av==null),bn=(bv==null);
        if(an&&bn)return 0; if(an)return 1; if(bn)return -1;
        return dir==='asc'?(av-bv):(bv-av);
      }).slice(0,3);
      if(arr.length<3){ podEl.innerHTML=''; podiumIds={}; return; }
      podiumIds={}; arr.forEach(function(p){ if(p.id)podiumIds[p.id]=1; });
      podEl.innerHTML='<div class="pod">'+arr.map(function(p,i){
        var fig=podFigure(p,k);
        // Skip the stat the card is already headlining: ranked by 2v2 MMR, the
        // big figure and the 2v2 cell underneath were the same number twice.
        var stats=POD_STATS.filter(function(st){ return st.k!==k; }).map(function(st){
          var lab=st.lab;
          if(!lab) lab=(st.k==='g2nd') ? (WIN_LABEL[win==='d7'?'d1':'d7']) : (WIN_LABEL[win]||win);
          return podStat(lab, st.get(p), false, st.na);
        });
        return '<div class="pc p'+(i+1)+'">'+
          '<div class="phead">'+
            '<div class="ptop">'+
              '<span class="pnum">'+String(i+1).padStart(2,'0')+'</span>'+
              teamMark(p.team)+
              '<span class="pwho"><b>'+esc(p.name)+'</b><i>'+esc(p.team||'Free agent')+'</i></span>'+
              // Region and Steam status stacked in the top corner, the two
              // things the table shows beside a name that the card was missing.
              // Playing joins the top of the stack when it applies, so it keeps
              // the corner and nothing has to share a line.
              '<span class="pmeta">'+
                (isLive(p)?'<span class="plive">Playing</span>':'')+
                (p.region?regionChip(p.region):'')+
                statusChip(p.status)+
              '</span>'+
            '</div>'+
            '<div class="pfig"><b>'+(fig==null?'&middot;':fig)+'</b><span>'+(METRIC_LABEL[k]||'')+'</span></div>'+
          '</div>'+
          '<div class="prow">'+stats.join('')+'</div>'+
        '</div>';
      }).join('')+'</div>';
    };

    // ---- player rows open for the rest of their numbers ----
    //
    // The phone list shows two figures; the other nine are a tap away rather
    // than a screen away. One row at a time, and the open one is restored after
    // a repaint so a refresh does not close it under the reader.
    var openPlayer=null;
    var applyOpenPlayer=function(){
      var rows=pv.querySelectorAll('tbody tr');
      Array.prototype.forEach.call(rows,function(tr){
        tr.classList.toggle('open',!!openPlayer&&tr.getAttribute('data-player')===openPlayer);
      });
    };
    pv.addEventListener('click',function(e){
      if(e.target.closest&&e.target.closest('a'))return;
      var tr=e.target.closest?e.target.closest('tbody tr'):null;
      if(!tr)return;
      var name=tr.getAttribute('data-player');
      openPlayer=(openPlayer===name)?null:name;
      applyOpenPlayer();
    });

    // ---- team drilldown: click a team to compare its roster; only one open at a time ----
    var openTeam=null; // team name of the expanded row, so refreshes can restore it
    var toggleTeam=function(tr){
      if(!tr||!tv.contains(tr))return;
      var open=tv.querySelector('tr.exp-row');
      var same=open&&open.previousElementSibling===tr;
      if(open){ open.parentNode.removeChild(open); }
      var prev=tv.querySelector('tr.team-row.open'); if(prev){ prev.classList.remove('open'); prev.setAttribute('aria-expanded','false'); }
      if(same){ openTeam=null; return; }
      openTeam=tr.getAttribute('data-team');
      tr.classList.add('open'); tr.setAttribute('aria-expanded','true');
      var exp=document.createElement('tr'); exp.className='exp-row';
      exp.innerHTML='<td colspan="'+tCols.length+'">'+teamPanel(tr.getAttribute('data-team'))+'</td>';
      tr.parentNode.insertBefore(exp,tr.nextSibling);
    };

    // Re-open after a repaint. Called on refresh, not on user interaction, so
    // an expanded roster survives new numbers arriving underneath it.
    var restoreOpenTeam=function(){
      if(!openTeam)return;
      var want=openTeam;
      var tr=tv.querySelector('tr.team-row[data-team="'+want.replace(/"/g,'\\"')+'"]');
      if(!tr){ openTeam=null; return; }
      openTeam=null;      // toggleTeam sets it again
      toggleTeam(tr);
    };
    tv.addEventListener('click',function(e){ var tr=e.target.closest?e.target.closest('tr.team-row'):null; if(tr)toggleTeam(tr); });
    tv.addEventListener('keydown',function(e){ if(e.key!=='Enter'&&e.key!==' ')return; var tr=e.target.closest?e.target.closest('tr.team-row'):null; if(tr){ e.preventDefault(); toggleTeam(tr); } });

    // ---- rank-by buttons ----
    //
    // One control does two jobs, because to a reader they are the same job:
    // it sets which column the table is ordered by, and for the two games
    // options it also sets which window that column shows. Ordering by a
    // column that is not on screen would be the confusing version.
    var metricBtns=document.querySelectorAll('#metricSeg button[data-k]');
    var markMetric=function(k){
      Array.prototype.forEach.call(metricBtns,function(b){
        var mine=(b.dataset.k==='mmr')
          ? (k==='ones'||k==='twos'||k==='threes')
          : (b.dataset.k===k&&(!b.dataset.w||b.dataset.w===win));
        b.setAttribute('aria-pressed',mine?'true':'false');
      });
    };
    // MMR is one button holding three playlists. Clicking it while it is
    // already the active order steps 1v1 -> 2v2 -> 3v3 and back, so the
    // playlist is switched where it is read rather than in a separate control.
    var PLAYLISTS=['ones','twos','threes'];
    var PL_LABEL={ones:'1v1',twos:'2v2',threes:'3v3'};
    var showMmrPlaylist=function(){
      var el=document.getElementById('mmrPl');
      if(el)el.textContent=PL_LABEL[mmrKey];
    };
    var setMetric=function(btn,fromClick){
      var k=btn.dataset.k, w=btn.dataset.w;
      if(w){
        win=w;
        var th=pv.querySelector('th.c-g14 span'); if(th)th.textContent=WIN_LABEL[w];
      }
      if(k==='mmr'){
        var cur=paintP.sortKey();
        // Already ranking by MMR, so this click means "next playlist". Only a
        // real click advances it: the first paint sets the mode, not the step.
        if(fromClick&&(cur==='ones'||cur==='twos'||cur==='threes')){
          mmrKey=PLAYLISTS[(PLAYLISTS.indexOf(mmrKey)+1)%PLAYLISTS.length];
        }
        k=mmrKey;
        showMmrPlaylist();
      }
      markMetric(k);
      renderPodium(k);
      paintP.setSort(k,'desc');
    };
    Array.prototype.forEach.call(metricBtns,function(b){
      b.addEventListener('click',function(){setMetric(b,true);});
    });

    // A header click still sorts, so the buttons drop their highlight rather
    // than claiming an order the table is no longer in.
    pv.addEventListener('click',function(e){
      var th=e.target.closest?e.target.closest('th.sortable'):null;
      if(!th)return;
      var k=paintP.sortKey();
      if(k==='ones'||k==='twos'||k==='threes'){ mmrKey=k; showMmrPlaylist(); }
      markMetric(k);
      renderPodium();
      paintP();
    });

    // ---- region filter ----
    //
    // Sixty players is a lot to read at once and region is how people ask the
    // question ("who is grinding in NA"). Counts sit on the buttons so an
    // empty region is obvious before it is clicked.
    var regionSeg=document.getElementById('regionSeg');
    var buildRegions=function(){
      if(!regionSeg)return;
      var counts={};
      players.forEach(function(p){ if(p.region)counts[p.region]=(counts[p.region]||0)+1; });
      var order=['EU','NA','SAM','MENA','APAC','OCE','SSA'].filter(function(r){return counts[r];});
      regionSeg.innerHTML='<button data-r="" aria-pressed="'+(regionQ?'false':'true')+'">All<span class="rn">'+players.length+'</span></button>'+
        order.map(function(r){
          return '<button data-r="'+r+'" aria-pressed="'+(regionQ===r?'true':'false')+'">'+r+'<span class="rn">'+counts[r]+'</span></button>';
        }).join('');
      Array.prototype.forEach.call(regionSeg.querySelectorAll('button'),function(b){
        b.addEventListener('click',function(){
          regionQ=b.dataset.r||'';
          Array.prototype.forEach.call(regionSeg.querySelectorAll('button'),function(x){
            x.setAttribute('aria-pressed',(x.dataset.r||'')===regionQ?'true':'false');
          });
          renderPodium(); paintP(); paintT();
        });
      });
    };
    buildRegions();

    // Playing belongs with the buttons that decide what the board shows, not
    // with the regions, which answer a different question. It only exists while
    // somebody is actually on the ladder.
    var playingSeg=document.getElementById('playingSeg');
    var buildPlaying=function(){
      if(!playingSeg)return;
      var live=players.filter(isLive).length;
      if(!live){
        playingSeg.hidden=true; playingSeg.innerHTML='';
        if(liveOnly){ liveOnly=false; renderPodium(); paintP(); }
        return;
      }
      playingSeg.hidden=false;
      playingSeg.innerHTML='<button class="pbtn" id="playingBtn" aria-pressed="'+(liveOnly?'true':'false')+'">Playing<span class="rn">'+live+'</span></button>';
      document.getElementById('playingBtn').addEventListener('click',function(){
        liveOnly=!liveOnly;
        this.setAttribute('aria-pressed',liveOnly?'true':'false');
        renderPodium(); paintP(); paintT();
      });
    };
    buildPlaying();

    showMmrPlaylist();
    setMetric(metricBtns[0]);

    // ---- search ----
    var input=document.getElementById('search'), wrap=document.getElementById('searchWrap');
    input.addEventListener('input',function(){ searchQ=input.value.trim().toLowerCase(); wrap.classList.toggle('has',!!searchQ); renderPodium(); paintP(); paintT(); });
    document.getElementById('searchClear').addEventListener('click',function(){ input.value=''; searchQ=''; wrap.classList.remove('has'); renderPodium(); paintP(); paintT(); input.focus(); });

    // ---- view toggle ----
    var tabP=document.getElementById('tabPlayers'), tabT=document.getElementById('tabTeams');
    var wrowEl=document.getElementById('wrow');
    var podWrap=document.getElementById('podium');
    var show=function(isP){ tabP.setAttribute('aria-selected',isP?'true':'false'); tabT.setAttribute('aria-selected',isP?'false':'true'); pv.hidden=!isP; tv.hidden=isP; if(wrowEl)wrowEl.style.display=isP?'':'none'; if(podWrap)podWrap.style.display=isP?'':'none'; };
    tabP.addEventListener('click',function(){show(true);});
    tabT.addEventListener('click',function(){show(false);});

    // ---- feedback -> posted to the Worker, which files the GitHub issue ----
    // The site is static, so it cannot hold a token; the Worker holds it and
    // this just posts JSON. Falls back to opening a prefilled issue if the
    // Worker is unreachable, so feedback is never simply lost.
    var FB_ENDPOINT=window.__FB_ENDPOINT__||'/feedback';
    var REPO='https://github.com/Bordder/RLProTracker';
    var fb=document.getElementById('fbForm');
    if(fb){
      var fbRes=document.getElementById('fbResult');
      var fbBtn=document.getElementById('fbBtn');
      fb.addEventListener('submit',function(e){
        e.preventDefault();
        var hp=document.getElementById('fbHp').value;
        var user=(document.getElementById('fbUser').value||'').trim().slice(0,60);
        var type=document.getElementById('fbType').value;
        var msg=(document.getElementById('fbMsg').value||'').trim().slice(0,2000);
        if(!msg){ fbRes.textContent='Add a message first.'; fbRes.className='msg err'; document.getElementById('fbMsg').focus(); return; }
        fbBtn.disabled=true;
        fbRes.textContent='Sending…'; fbRes.className='msg';
        fetch(FB_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({user:user,type:type,message:msg,hp:hp})})
          .then(function(r){ if(!r.ok)throw new Error('http '+r.status); return r.json(); })
          .then(function(){
            fbRes.textContent='Sent. Thanks!'; fbRes.className='msg ok'; fb.reset();
          })
          .catch(function(){
            // Last resort: hand the user the prefilled issue rather than dropping
            // what they wrote.
            var title=type+(user?(' from '+user):'')+': '+msg.split('\n')[0].slice(0,60);
            var body=msg+'\n\n---\nType: '+type+'\nFrom: '+(user||'anonymous')+'\nVia: RL Pro Tracker feedback form';
            window.open(REPO+'/issues/new?title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body),'_blank','noopener,noreferrer');
            fbRes.textContent='Could not send directly - opening GitHub instead.'; fbRes.className='msg err';
          })
          .then(function(){ fbBtn.disabled=false; });
      });
    }

    // Started here rather than beside renderStatus, because a refresh repaints
    // the tables and those are built further down.
    // Collection runs every 2 minutes, so polling every 60 seconds means a tab
    // is never more than about a minute behind the numbers existing. At the old
    // 150s a poll could just miss a collection and leave the page five minutes
    // stale while everything upstream was working perfectly.
    // The probe is a few dozen bytes and is collapsed at the edge for 20s, so
    // the poll rate costs upstream nothing.
    // Freshness is driven by two things: a timer, and any sign the reader is
    // actually here. The timer alone is not enough and never was. A hidden tab
    // has its timers throttled to near nothing, a long-idle one can be frozen
    // outright so they stop completely, and a machine returning from sleep
    // resumes whenever it likes. Measured on the live site: a tab holding
    // 23:12 data sat there while the server was at 23:14, and one poll fired
    // by hand pulled everything current immediately. The fetch was never the
    // problem; nothing was asking.
    //
    // visibilitychange alone was too narrow, because a reader can come back
    // without the page ever having been hidden: another window raised over
    // this one, a second monitor, a machine waking up. So every ordinary sign
    // of presence counts, rate limited so it costs nothing.
    var lastAsk=0;
    var ensureFresh=function(force){
      var now=Date.now();
      if(!force&&now-lastAsk<15000)return;
      lastAsk=now;
      pollStatus();
    };

    setInterval(function(){ensureFresh(true);},60000);
    ensureFresh(true);

    document.addEventListener('visibilitychange',function(){ if(!document.hidden)ensureFresh(true); });
    // persisted means bfcache handed back the DOM and the timers exactly as
    // they were frozen; the plain case covers an ordinary restore too.
    window.addEventListener('pageshow',function(){ ensureFresh(true); });
    window.addEventListener('online',function(){ ensureFresh(true); });
    window.addEventListener('focus',function(){ ensureFresh(true); });
    ['pointerdown','keydown','wheel','touchstart','scroll'].forEach(function(ev){
      window.addEventListener(ev,function(){ensureFresh(false);},{passive:true});
    });

    var yr=document.getElementById('yr'); if(yr)yr.textContent=String(new Date().getFullYear());
  });
})();
