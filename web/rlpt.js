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
  // Rating, with how far it has moved over the selected window underneath.
  //
  // Movement rides on the rating rather than taking columns of its own: three
  // more numeric columns would have been the widest change on the board for
  // the least gain, and every ranked-stats site puts the delta on the figure
  // it belongs to. Zero is drawn as nothing at all - a row of grey 0s reads as
  // broken, where an absent delta reads as "did not move", which is the truth.
  var mmrCell=function(v,slot){
    var cls='c-mmr'+(slot?' '+slot:'');
    var lab=slot==='m1'?'1v1':slot==='m3'?'3v3':'2v2';
    return v==null
      ? '<td class="'+cls+'" data-l="'+lab+'"><span class="dash">&middot;</span></td>'
      : '<td class="'+cls+'" data-l="'+lab+'"><span class="mv '+tierClass(v)+'">'+nf(v)+'</span></td>';
  };
  // Rating history, fetched the first time somebody opens the ratings tab
  // rather than on every page load. Ninety days of it is far larger than the
  // board itself and most visitors never go there, so it should not be on the
  // critical path for anyone.
  var mmrHist={}, mmrBase=0, mmrState='idle';
  var loadMmrHistory=function(then){
    if(mmrState==='done'){ then(); return; }
    if(mmrState==='loading')return;
    mmrState='loading';
    getJson('mmr-history.json').then(function(j){
      if(j&&j.players){ mmrHist=j.players; mmrBase=j.base||0; }
      mmrState='done';
      then();
    });
  };
  var seriesFor=function(id,key){
    var h=mmrHist[id];
    return (h&&h[key]&&h[key].length>1)?h[key]:null;
  };

  var MMR_COL_TITLE='Current rating in this playlist.';

  var PL_NAME={ones:'1v1',twos:'2v2',threes:'3v3'};
  // The window is however much history exists, which grows toward 90 days from
  // the day the longer retention shipped. Saying "last 14 days" over a chart
  // holding six would be a lie the reader cannot check.
  var chartSpanWords=function(spanMin){
    var d=Math.max(1,Math.round(spanMin/1440));
    return d<14?('last '+d+' day'+(d===1?'':'s')):d<60?('last '+Math.round(d/7)+' weeks'):('last '+Math.round(d/30)+' months');
  };
  var WIN_LABEL={d1:'24h',d7:'7d',d14:'14d'};
  // The column header says what is being counted; "24h" on its own named a
  // period and left the reader to guess it meant games.
  var COL_LABEL={d1:'Games, 24h',d7:'Games, 7d',d14:'Games, 14d'};
  // ---- copy a row as a line of text ----
  //
  // A row read out loud in Discord, not a screenshot: plain text rather than
  // markdown, because Discord renders a table badly and a code fence turns a
  // one-line answer into a block. Same order as the columns, so what is copied
  // matches what was being looked at.
  //
  // The button is a gutter icon that only appears on hover or keyboard focus.
  // On 94 rows a permanently visible control is 94 pieces of furniture.
  var COPY_SVG='<svg class="cp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
  var OK_SVG='<svg class="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>';
  var copyBtn=function(label){
    return '<button class="copyrow" type="button" title="Copy as text" aria-label="Copy '+esc(label)+' as text">'+COPY_SVG+OK_SVG+'</button>';
  };
  // execCommand is deprecated and still the only thing that works without a
  // secure context, which is what a local preview over plain http is.
  var legacyCopy=function(text){
    var ta=document.createElement('textarea');
    ta.value=text; ta.setAttribute('readonly','');
    ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    var ok=false; try{ ok=document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
    return ok;
  };
  var copyText=function(text,btn){
    var done=function(){
      // The icon becoming a tick is the whole confirmation: a toast for a copy
      // is more interruption than the action was.
      btn.classList.add('done');
      setTimeout(function(){ btn.classList.remove('done'); },1200);
    };
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done,function(){ if(legacyCopy(text))done(); });
      return;
    }
    if(legacyCopy(text))done();
  };
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
    // A figure the player gave for an account we cannot read. Marked, because
    // it is a claim and not a reading: it does not move, and it is only as
    // round as whatever they said.
    if(p.totalStated){
      var src=typeof p.totalStated==='string'?p.totalStated:'Stated by the player';
      return'<span class="est" title="'+esc(src)+'. Not measured - this profile keeps its hours private.">'+v+'</span>';
    }
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
    'MIBR':'SAM','FURIA':'SAM','Bigodes':'SAM',
    'Twisted Minds':'MENA','Team Falcons':'MENA','R8 Esports':'MENA',
    // Mate y Tapa won the EU LCQ and entered Worlds as the EU seed: the roster is
    // Spanish and Argentinian, but the region here is the competitive one.
    // Five Fears announced an SSA entry in Nov 2025 and qualified through SSA Open 3.
    'Mate y Tapa':'EU','Five Fears':'SSA',
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
    'team-falcons':'FAL'
  };
  var LOGO_INSET={'virtuspro':6};
  var TEAM_LOGO={'geng-mobil1-racing':'png','karmine-corp':'png','lil-step-bros':'png','mibr':'png','nrg':'png','shopify-rebellion':'png','spacestation-gaming':'png','team-bsk':'png','tsm':'png'};
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
          tier:t.tier||null,
          seasonGames:t.seasonGames?t.seasonGames.total:null,
          // Per playlist as well as the total, for the panel a row opens into.
          seasonByPl:t.seasonGames||null,
          gamesByPl:t.games||null,
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
          totalHours:p.totalHours!=null?p.totalHours:null, totalFrozenAt:p.totalHoursFrozenAt||null,
          totalStated:p.totalHoursStated||null };
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
  var syncUrl;      // assigned by the URL block below; see 'the view, in the address bar'
  var podiumIds={};  // whoever is shown large above the table
  // The podium is a wide-screen device. On a phone its three cards cost 870px,
  // which is most of a screen spent on three players, so the list carries the
  // top three itself and marks them instead. Kept as a live query rather than a
  // one-off read so that rotating or resizing re-renders correctly.
  var PHONE=window.matchMedia('(max-width:700px)');

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

        // Every control that changes what is on screen repaints, so this is the
        // one place the address bar has to be kept in step with.
        if(typeof syncUrl==='function')syncUrl();
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
    var pCols=[{label:'#',cls:'c-rk'},{label:'Player',cls:'c-who',k:'name'},{label:'Region',cls:'c-rg',k:'region'},{label:'Status',cls:'c-st',k:'status'},{label:'1v1',cls:'c-mmr',k:'ones',num:true,title:MMR_COL_TITLE},{label:'2v2',cls:'c-mmr',k:'twos',num:true,title:MMR_COL_TITLE},{label:'3v3',cls:'c-mmr',k:'threes',num:true,title:MMR_COL_TITLE},{label:'Total games',cls:'c-sg',k:'sg',num:true,title:'Ranked games played since the current competitive season began'},{label:COL_LABEL[win],cls:'c-g14',k:'g14',num:true,title:'Ranked games played in the window selected above the table'},{label:'2wk h',cls:'c-hr c-hr2',k:'h2',num:true},{label:'Total h',cls:'c-hr c-hrt',k:'ht',num:true},{label:'',cls:'c-cp'}];
    var pAcc={name:function(p){return(p.name||'').toLowerCase();},region:function(p){return p.region||null;},status:function(p){return p.status?String(p.status).toLowerCase():null;},ones:function(p){return p.mmr?p.mmr.ones:null;},twos:function(p){return p.mmr?p.mmr.twos:null;},threes:function(p){return p.mmr?p.mmr.threes:null;},sg:function(p){return p.seasonGames;},g14:function(p){
        // "pending" in the cell means the window has not filled yet, so there is
        // nothing to rank: a new player's first reading is their whole season,
        // which would otherwise put them top of a 24h ordering.
        var g=p.games&&p.games[win];
        return g&&g.games!=null&&!g.partial?g.games:null;
      },h2:function(p){return p.hours2wk!=null?p.hours2wk:p.estHours2wk;},ht:function(p){return p.totalHours;}};
    var playerRow=function(p){
      var mmr=p.hasMmr?(mmrCell(p.mmr.ones,'m1')+mmrCell(p.mmr.twos,'m2')+mmrCell(p.mmr.threes,'m3')):'<td class="c-mmr norank" colspan="3">no ranked data</td>';
      return '<tr class="'+(p.hasMmr?'':'isnorank')+(p.__pos<=3?' lead lead'+p.__pos:'')+'" data-player="'+esc(p.name)+'">'+
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
        '<td class="c-g14" data-l="'+esc((WIN_LABEL[win]||win)+' games')+'">'+fmtGames(p,win)+'</td>'+
        '<td class="c-hr c-hr2" data-l="2wk h">'+hours2wkCell(p)+'</td>'+
        '<td class="c-hr c-hrt" data-l="total h">'+totalHoursCell(p)+'</td>'+
        '<td class="c-cp">'+copyBtn(p.name)+'</td>'+
        '</tr>';
    };
    var pMatch=function(p,q){return (String(p.name||'')+' '+String(p.team||'')+' '+String(p.region||'')).toLowerCase().indexOf(q)>=0;};

    var tCols=[{label:'#',cls:'c-rk'},{label:'Team',cls:'c-who',k:'name'},{label:'Region',cls:'c-rg',k:'region'},{label:'',cls:'c-fill'},{label:'Avg 1v1',cls:'c-mmr',k:'ones',num:true},{label:'Avg 2v2',cls:'c-mmr',k:'twos',num:true},{label:'Avg 3v3',cls:'c-mmr',k:'threes',num:true},{label:'Games',cls:'c-sg',k:'sg',num:true,title:'Total ranked games played by the roster since the current competitive season began'},{label:'Games, 24h',cls:'c-g14',k:'g14',num:true,title:'Ranked games played by the whole roster in the last 24 hours'},{label:'2wk h',cls:'c-hr',k:'h2',num:true},{label:'Total h',cls:'c-hr',k:'ht',num:true},{label:'',cls:'c-cp'}];
    var tAcc={name:function(t){return(t.team||'').toLowerCase();},region:function(t){return t.region||null;},ones:function(t){return t.avgMmr?t.avgMmr.ones:null;},twos:function(t){return t.avgMmr?t.avgMmr.twos:null;},threes:function(t){return t.avgMmr?t.avgMmr.threes:null;},sg:function(t){return t.seasonGames;},g14:function(t){return t.games?t.games.d1:null;},h2:function(t){return t.hours2wk;},ht:function(t){return t.totalHours;}};
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

  // Fixed at 24 hours rather than following the players tab's window toggle:
  // that control is hidden while the teams table is up, so a header that could
  // silently read 7d would leave no visible way to tell. Same reason the roster
  // panel fixes its own window.
  //
  // The sum only counts players whose 24h window has actually filled, so a team
  // carrying a newly added player is understated. Marked the way partial hours
  // are rather than printed as if it were the whole roster.
  var teamGamesCell=function(t){
    var v=t.games?t.games.d1:null;
    if(v==null)return'<span class="dash">&middot;</span>';
    var roster=byTeam[t.team]||[];
    var counted=roster.filter(function(p){var g=p.games&&p.games.d1;return g&&g.games!=null&&!g.partial;}).length;
    var body=v?'<span class="g14v">'+nf(v)+'</span>':'<span class="mv">0</span>';
    if(roster.length&&counted&&counted<roster.length)
      return'<span class="part" title="'+counted+' of '+roster.length+' players have been tracked for a full 24 hours; the rest are still pending.">'+body+'</span>';
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
        '<td class="c-g14" data-l="24h games">'+teamGamesCell(t)+'</td>'+
        '<td class="c-hr c-hr2" data-l="2wk h">'+teamHoursCell(t,t.hours2wk,hf)+'</td>'+
        '<td class="c-hr c-hrt" data-l="total h">'+teamHoursCell(t,t.totalHours,function(x){return nf(Math.round(x));})+'</td>'+
        '<td class="c-cp">'+copyBtn(t.team)+'</td></tr>';
    };
    var tMatch=function(t,q){return (String(t.team||'')+' '+String(t.region||'')).toLowerCase().indexOf(q)>=0;};
    // The copied line follows the board rather than a fixed set of figures: the
    // playlist is whichever one is being read, so a line pasted from a 1v1 view
    // says 1v1. A figure that is missing is left out instead of printed as a
    // dash, which reads as noise away from the table.
    var SEP=' · ';
    var mmrBit=function(m,prefix){
      if(!m)return null;
      var out=[];
      ['ones','twos','threes'].forEach(function(k){
        if(m[k]!=null)out.push((prefix||'')+PL_LABEL[k]+' '+nf(m[k]));
      });
      return out.length?out:null;
    };
    var copyLinePlayer=function(p){
      var bits=[p.name+(p.team?(' ('+p.team+')'):'')];
      if(p.mmr&&p.mmr[mmrKey]!=null)bits.push(PL_LABEL[mmrKey]+' '+nf(p.mmr[mmrKey]));
      var h=p.hours2wk!=null?p.hours2wk:p.estHours2wk;
      if(h!=null)bits.push(hf(h)+'h in 2wk');
      return bits.join(SEP);
    };
    // A player's line inside a team paste. Every playlist rather than the one
    // being read, because the point of pasting a team is the comparison down
    // the roster, and season games is the figure that separates them.
    var rosterLine=function(p){
      var bits=[p.name], m=mmrBit(p.mmr);
      if(m)bits=bits.concat(m);
      if(p.seasonGames!=null)bits.push(nf(p.seasonGames)+' games this season');
      var h=p.hours2wk!=null?p.hours2wk:p.estHours2wk;
      if(h!=null)bits.push(hf(h)+'h in 2wk');
      if(p.totalHours!=null)bits.push(nf(Math.round(p.totalHours))+'h total');
      return bits.join(SEP);
    };
    // Team first with everything it has, then a blank line, then the roster one
    // player per line. Pasted into Discord that is a readable block rather than
    // a paragraph, and the blank line is what keeps the team from reading as
    // just another member of its own roster.
    var copyLineTeam=function(t){
      var bits=[t.team+(t.region?(' ('+t.region+')'):'')], m=mmrBit(t.avgMmr,'avg ');
      if(m)bits=bits.concat(m);
      if(t.seasonGames!=null)bits.push(nf(t.seasonGames)+' games this season');
      if(t.tracked&&t.hours2wk!=null)bits.push(hf(t.hours2wk)+'h in 2wk');
      if(t.tracked&&t.totalHours!=null)bits.push(nf(Math.round(t.totalHours))+'h total');
      var out=[bits.join(SEP)];
      var roster=(byTeam[t.team]||[]).slice();
      roster.sort(function(a,b){return (b.mmr&&b.mmr.twos||0)-(a.mmr&&a.mmr.twos||0);});
      if(roster.length)out.push('',roster.map(rosterLine).join('\n'));
      return out.join('\n');
    };

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
    var METRIC_LABEL={twos:'2v2 MMR',ones:'1v1 MMR',threes:'3v3 MMR',sg:'total games',g14:'games',h2:'hours, 2wk',ht:'hours total',name:'',region:'',status:''};
    // The headline names its window. Ranking by 24h printed "74 GAMES" over a
    // stat cell reading "1,785 GAMES", two different figures under one word.
    var podLabel=function(k){
      if(k==='g14')return (WIN_LABEL[win]||win)+' games';
      return METRIC_LABEL[k]||'';
    };
    // Every podium card carries the same six figures the table columns do, so
    // reading across the top three is the same job as reading down the list.
    var POD_STATS=[
      {k:'ones',  lab:'1v1',    get:function(p){ return p.mmr&&p.mmr.ones!=null?nf(p.mmr.ones):null; }},
      {k:'twos',  lab:'2v2',    get:function(p){ return p.mmr&&p.mmr.twos!=null?nf(p.mmr.twos):null; }},
      {k:'threes',lab:'3v3',    get:function(p){ return p.mmr&&p.mmr.threes!=null?nf(p.mmr.threes):null; }},
      {k:'sg',    lab:'games', get:function(p){ return p.seasonGames!=null?nf(p.seasonGames):null; }},
      {k:'g14',   lab:null, na:'pending', get:function(p){ var g=p.games&&p.games[win]; return g&&g.games!=null&&!g.partial?nf(g.games):null; }},
      {k:'h2',    lab:'2wk h',  get:function(p){ var h=p.hours2wk!=null?p.hours2wk:p.estHours2wk; return h!=null?(p.hours2wk!=null?hf(h):'<span class="est">'+hf(h)+'</span>'):null; }}
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
      // The :empty height reservations in the stylesheet hold the first paint's
      // place so the footer does not leap when data lands. Once players are in
      // hand an empty podium is a real answer - a search, a phone, a lookup
      // ordering, a filter matching fewer than three - and the reserved height
      // is just a hole under the controls. Marking the element drops the
      // reservation without touching the pre-load behaviour.
      if(players.length)podEl.classList.add('is-ready');
      if(PHONE.matches){ podEl.innerHTML=''; podiumIds={}; return; }
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
        // Two ratings then the season's games, whatever the board is ranked by,
        // so every card reads the same way. Filtering the list and taking the
        // first three did not: ranking by 24h or by hours left all three ratings
        // in and pushed games off the end, so the trio changed shape depending
        // on a control above the cards rather than on anything about the player.
        // Games is the exception when it is already the headline figure.
        var pls=['ones','twos','threes'].filter(function(x){ return x!==k; });
        var want=(k==='sg')?pls:pls.slice(0,2).concat(['sg']);
        var stats=want.map(function(key){
          var st=POD_STATS.filter(function(x){ return x.k===key; })[0];
          return st?podStat(st.lab, st.get(p), false, st.na):'';
        });
        return '<div class="pc p'+(i+1)+'" data-player="'+esc(p.name)+'" role="button" tabindex="0" aria-expanded="false">'+
          // Same control as the table rows carry, in the card's own corner.
          copyBtn(p.name)+
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
            '<div class="pfig"><b>'+(fig==null?'&middot;':fig)+'</b><span>'+podLabel(k)+'</span></div>'+
          '</div>'+
          '<div class="prow">'+stats.join('')+'</div>'+
        '</div>';
      }).join('')+'</div><div id="podExp"></div>';
      applyOpenPod();
    };

    // ---- the top three open too -------------------------------------------
    //
    // The cards headline the board and were the one part of it with nothing
    // behind them. Same panel the rows open into, rendered under all three
    // rather than inside one of them: at a third of the width the figures
    // would wrap to one word a line, and the full width is already there.
    var openPod=null;
    var applyOpenPod=function(){
      var host=document.getElementById('podExp');
      if(!host)return;
      var cards=podEl.querySelectorAll('.pc'), found=null;
      Array.prototype.forEach.call(cards,function(c){
        var on=!!openPod&&c.getAttribute('data-player')===openPod;
        c.classList.toggle('open',on);
        if(on)found=c.getAttribute('data-player');
      });
      if(!found){ openPod=null; host.innerHTML=''; return; }
      var p=players.filter(function(x){return x.name===openPod;})[0];
      host.innerHTML=p?detailInner(p):'';
    };
    podEl.addEventListener('click',function(e){
      if(e.target.closest&&e.target.closest('a'))return;
      // Copying must not also open the card: the icon sits inside it.
      var cb=e.target.closest?e.target.closest('.copyrow'):null;
      if(cb){
        var ccard=cb.closest('.pc'), cname=ccard&&ccard.getAttribute('data-player');
        var cp=players.filter(function(x){return x.name===cname;})[0];
        if(cp)copyText(copyLinePlayer(cp),cb);
        return;
      }
      var jump=e.target.closest?e.target.closest('.pexp-link'):null;
      if(jump){
        rvPicked=[jump.getAttribute('data-id')]; rvTouched=true;
        show('ratings');
        return;
      }
      // Clicks inside the open panel are not a request to close it.
      if(e.target.closest&&e.target.closest('#podExp'))return;
      var card=e.target.closest?e.target.closest('.pc'):null;
      if(!card)return;
      var who=card.getAttribute('data-player');
      openPod=(openPod===who)?null:who;
      // One panel on the page at a time. Two open at once is two screens of
      // scrolling between the board and the row somebody was reading.
      if(openPod&&openPlayer){ openPlayer=null; applyOpenPlayer(); }
      applyOpenPod();
    });

    // ---- a row opens for the rest of its numbers ---------------------------
    //
    // On a phone the row itself reflows into tiles; on a wide screen it opens a
    // panel underneath. One row at a time, and the open one is restored after a
    // repaint so a refresh does not close it under the reader.
    //
    // The rating chart that used to head this panel is gone: wedged into a
    // table row it was fighting the layout around it, and rating history now
    // has a tab of its own with the room to hold more than one line. In its
    // place are the figures the wide table no longer prints, in the order the
    // columns used to run.
    // The table cell prints "3d ago" in place of a zero, because a zero on its
    // own cannot tell someone who stopped last night from someone nobody has
    // seen in a fortnight. In here Last played is two lines below, so the
    // substitution would print the same words twice and the zero is the honest
    // figure.
    var panelGames=function(p,w){
      var g=p.games&&p.games[w||win];
      if(!g||g.games==null)return'<span class="dash">&middot;</span>';
      if(g.partial)return'<span class="pending">pending</span>';
      return'<span class="g14v">'+nf(g.games)+'</span>';
    };
    var openPlayer=null;
    var detailInner=function(p){
      // Steam first because it qualifies everything after it: whether the
      // hours below are measured, estimated or simply unavailable is decided
      // by what the profile lets us see. Then activity newest-first - the
      // window, the fortnight, the lifetime - and last played closes it,
      // being the one figure that is a date rather than a total.
      //
      // Rank is gone. 93 of the 94 tracked pros are Supersonic Legend in 2v2,
      // so it printed the same three words on almost every panel.
      // Both windows, named rather than following the board's toggle: the top
      // three used to carry them and no longer do, and a panel that silently
      // changes which window it means is worse than one that says.
      var facts=[
        ['Steam', statusChip(p.status)],
        ['Games, 24h', panelGames(p,'d1')],
        ['Games, 7d', panelGames(p,'d7')],
        ['Hours, 2 weeks', hours2wkCell(p).replace(/^<td[^>]*>|<\/td>$/g,'')],
        ['Hours, total', totalHoursCell(p).replace(/^<td[^>]*>|<\/td>$/g,'')],
        ['Last played', p.lastPlayedAt?esc(agoShort(p.lastPlayedAt)):'<span class="dash">&middot;</span>']
      ];
      if(isLive(p)&&p.session){
        // Both figures on the value line, so the entry is two lines like every
        // other one and the panel does not grow taller when somebody is live.
        var mins=p.session.startedAt?Math.round((Date.now()-p.session.startedAt)/60000):null;
        var g=p.session.games;
        // Always minutes, even at 128m. An hours figure rounds a session into
        // something vaguer than the thing being described: "2h" covers anything
        // from 105 to 134 minutes, and the point of this line is that it is
        // happening right now.
        var forWhen=mins==null?null:(mins+'m');
        var played=g!=null?(nf(g)+(g===1?' game':' games')):null;
        // Last played says "5m ago" for somebody who is on the ladder right now,
        // which is the same fact worded as if they had stopped.
        facts=facts.filter(function(f){ return f[0]!=='Last played'; });
        facts.unshift(['Playing now',
          [forWhen,played].filter(Boolean).join(':')||'yes']);
      }
      return '<div class="pexp-in">'+
        '<div class="pexp-facts">'+facts.map(function(f){
          return '<div><span class="pk">'+f[0]+'</span><span class="pvv">'+f[1]+'</span></div>';
        }).join('')+'</div>'+
        // Straight through to this player's rating history rather than making
        // the reader find them again in the other tab's search.
        '<button type="button" class="pexp-link" data-id="'+esc(p.id)+'" '+
          'aria-label="Rating history for '+esc(p.name)+'">Rating history &rarr;</button>'+
      '</div>';
    };
    var detailRow=function(p,span){
      return '<tr class="pexp"><td colspan="'+span+'">'+detailInner(p)+'</td></tr>';
    };
    var applyOpenPlayer=function(){
      var rows=pv.querySelectorAll('tbody tr');
      Array.prototype.forEach.call(rows,function(tr){
        if(tr.classList.contains('pexp'))return;
        var isOpen=!!openPlayer&&tr.getAttribute('data-player')===openPlayer;
        tr.classList.toggle('open',isOpen);
        var next=tr.nextElementSibling;
        var has=next&&next.classList.contains('pexp');
        if(isOpen&&!has){
          var p=players.filter(function(x){return x.name===openPlayer;})[0];
          if(p)tr.insertAdjacentHTML('afterend',detailRow(p,tr.children.length));
        }else if(!isOpen&&has){ next.parentNode.removeChild(next); }
      });
    };
    pv.addEventListener('click',function(e){
      if(e.target.closest&&e.target.closest('a'))return;
      // Copying must not also open the row: the icon sits inside it.
      var cb=e.target.closest?e.target.closest('.copyrow'):null;
      if(cb){
        var crow=cb.closest('tbody tr'), cname=crow&&crow.getAttribute('data-player');
        var cp=players.filter(function(x){return x.name===cname;})[0];
        if(cp)copyText(copyLinePlayer(cp),cb);
        return;
      }
      var jump=e.target.closest?e.target.closest('.pexp-link'):null;
      if(jump){
        rvPicked=[jump.getAttribute('data-id')]; rvTouched=true;
        show('ratings');
        return;
      }
      var tr=e.target.closest?e.target.closest('tbody tr'):null;
      if(!tr||tr.classList.contains('pexp'))return;
      var name=tr.getAttribute('data-player');
      openPlayer=(openPlayer===name)?null:name;
      if(openPlayer&&openPod){ openPod=null; applyOpenPod(); }
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
    tv.addEventListener('click',function(e){
      var cb=e.target.closest?e.target.closest('.copyrow'):null;
      if(cb){
        var crow=cb.closest('tr.team-row'), cname=crow&&crow.getAttribute('data-team');
        var ct=teams.filter(function(x){return x.team===cname;})[0];
        if(ct)copyText(copyLineTeam(ct),cb);
        return;
      }
      var tr=e.target.closest?e.target.closest('tr.team-row'):null; if(tr)toggleTeam(tr);
    });
    // Enter on the copy button is a copy, not a row toggle: the button sits
    // inside a row that is itself focusable.
    tv.addEventListener('keydown',function(e){ if(e.key!=='Enter'&&e.key!==' ')return; if(e.target.closest&&e.target.closest('.copyrow'))return; var tr=e.target.closest?e.target.closest('tr.team-row'):null; if(tr){ e.preventDefault(); toggleTeam(tr); } });

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
        var th=pv.querySelector('th.c-g14 span'); if(th)th.textContent=COL_LABEL[w];
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
    // Crossing the phone breakpoint changes whether the podium exists at all,
    // and the table's row count depends on that, so both are repainted.
    var onPhoneChange=function(){ renderPodium(); paintP(); };
    if(PHONE.addEventListener) PHONE.addEventListener('change',onPhoneChange);
    else if(PHONE.addListener) PHONE.addListener(onPhoneChange);

    input.addEventListener('input',function(){ searchQ=input.value.trim().toLowerCase(); wrap.classList.toggle('has',!!searchQ); renderPodium(); paintP(); paintT(); });
    document.getElementById('searchClear').addEventListener('click',function(){ input.value=''; searchQ=''; wrap.classList.remove('has'); renderPodium(); paintP(); paintT(); input.focus(); });

    // ---- view toggle ----
    var tabP=document.getElementById('tabPlayers'), tabT=document.getElementById('tabTeams'), tabR=document.getElementById('tabRatings');
    var wrowEl=document.getElementById('wrow');
    var podWrap=document.getElementById('podium');
    // Three panels, one at a time. The ordering buttons and the podium belong
    // to the players list and follow it rather than sitting over a table they
    // cannot reorder.
    var TABS=['players','teams','ratings'];
    var tabNow='players';
    var show=function(which){
      if(TABS.indexOf(which)<0)which='players';
      tabNow=which;
      tabP.setAttribute('aria-selected',which==='players'?'true':'false');
      tabT.setAttribute('aria-selected',which==='teams'?'true':'false');
      if(tabR)tabR.setAttribute('aria-selected',which==='ratings'?'true':'false');
      pv.hidden=which!=='players';
      tv.hidden=which!=='teams';
      if(rvEl)rvEl.hidden=which!=='ratings';
      if(wrowEl)wrowEl.style.display=which==='players'?'':'none';
      if(podWrap)podWrap.style.display=which==='players'?'':'none';
      // The board's search filters a table, and the ratings tab has neither a
      // table nor the same question: it has a search of its own for putting a
      // player on the chart. Two search boxes doing different things, one of
      // them inert, is worse than one.
      if(wrap)wrap.style.display=which==='ratings'?'none':'';
      if(which==='ratings')rvOpen();
      // Switching tabs changes the view without repainting either table, so
      // this is the one control that has to tell the address bar itself.
      if(typeof syncUrl==='function')syncUrl();
    };
    tabP.addEventListener('click',function(){show('players');});
    tabT.addEventListener('click',function(){show('teams');});
    if(tabR)tabR.addEventListener('click',function(){show('ratings');});
    // ---- the ratings tab ---------------------------------------------------
    //
    // Rating history used to open inside a table row and inside a podium card.
    // Both were the wrong shape for it: a chart squeezed into a row is fighting
    // the table around it, and one player at a time answers the least
    // interesting question. Here it has the width of the page and more than one
    // line on it, so the question becomes who is climbing and who is not.
    //
    // The playlist is this tab's own, not the board's. Changing the chart to 1v1
    // should not silently reorder the table waiting behind it.
    var rvEl=document.getElementById('ratingsView');
    // Six lines is where a chart stops being a comparison and starts being a
    // plate of spaghetti; it is also how many colours stay apart on this ground.
    var RV_MAX=6;
    var rvKey='twos', rvPicked=null, rvTouched=false, rvFilter='', rvReg=null;
    // Which of the picked players actually have a line in the window on screen,
    // so the legend can say when one of them does not.
    var rvDrawn={};
    // How much of the history to draw. Ratings barely move over a fortnight
    // and then swing forty points in an evening, so a chart of the whole
    // history draws the interesting part as a smudge against the right edge.
    // Cutting the window is what makes those hours readable: the vertical
    // scale is computed from whatever is shown, so a narrower window is a
    // real zoom rather than a crop.
    var RV_RANGES=[{k:'all',lab:'All',mins:null},{k:'7d',lab:'7d',mins:7*1440},
                   {k:'24h',lab:'24h',mins:1440},{k:'6h',lab:'6h',mins:360}];
    var rvRange='all';
    var rvListOpen=false, rvCursor=-1;
    var RV_W=1280, RV_H=380, RV_PADL=58, RV_PADR=16, RV_PADT=14, RV_PADB=30;

    var rvPool=function(){ return players.filter(function(p){ return !!seriesFor(p.id,rvKey); }); };
    // Opening the tab on an empty chart makes the reader do setup work before
    // they have seen what the page is for. The three highest ratings in the
    // chosen playlist are the ones most people came to look at anyway.
    var rvDefault=function(){
      return rvPool().slice().sort(function(a,b){
        return (b.mmr&&b.mmr[rvKey]||0)-(a.mmr&&a.mmr[rvKey]||0);
      }).slice(0,3).map(function(p){ return p.id; });
    };
    // The history arrives after the first paint, so the default cannot be picked
    // until it is here: before then every player looks like they have no series.
    // Once the reader has chosen for themselves, an empty chart is their empty
    // chart and nothing refills it.
    var rvSeed=function(){
      if(rvTouched||(rvPicked&&rvPicked.length))return;
      var def=rvDefault();
      if(def.length)rvPicked=def;
    };
    var rvPlayer=function(id){ return players.filter(function(x){return x.id===id;})[0]; };

    var multiChart=function(ids){
      var series=[];
      ids.forEach(function(id,i){
        var p=rvPlayer(id), pts=p?seriesFor(id,rvKey):null;
        // ci is the player's own slot, kept through every filter below. Taking
        // the colour from the drawn-series index instead meant that dropping one
        // line recoloured the ones after it: the legend would say Zen was blue
        // while the chart drew them orange.
        if(pts)series.push({id:id,name:p.name,pts:pts,ci:i%RV_MAX});
      });
      if(!series.length)return '<div class="chart-none">'+
        (mmrState!=='done'?'Loading the rating history…'
         :ids.length?('No '+PL_NAME[rvKey]+' history yet for anyone on the chart.')
         :'Search above to put a player on the chart.')+'</div>';
      // One window shared by every line, measured from the newest reading on the
      // chart rather than from the clock: a player last seen on Tuesday should
      // still be drawn beside one who played an hour ago.
      var mins=(RV_RANGES.filter(function(r){return r.k===rvRange;})[0]||{}).mins;
      if(mins){
        var newest=-Infinity;
        series.forEach(function(sr){ var last=sr.pts[sr.pts.length-1][0]; if(last>newest)newest=last; });
        var cut=newest-mins;
        series=series.map(function(sr){
          var kept=sr.pts.filter(function(pt){ return pt[0]>=cut; });
          // A rating does not stop existing between games, so a player with no
          // readings inside the window is carried across it at the last figure
          // known before it. A flat line is the true picture: they did not move.
          // The same carry closes both ends, so every line spans the full width
          // instead of starting or stopping wherever that player last queued.
          var before=null;
          for(var i=0;i<sr.pts.length;i++){ if(sr.pts[i][0]<cut)before=sr.pts[i]; else break; }
          if(before&&(!kept.length||kept[0][0]>cut))kept.unshift([cut,before[1]]);
          var last=kept.length?kept[kept.length-1]:null;
          if(last&&last[0]<newest)kept.push([newest,last[1]]);
          return kept.length>1?{id:sr.id,name:sr.name,pts:kept,ci:sr.ci}:null;
        }).filter(Boolean);
        if(!series.length)return '<div class="chart-none">No readings in the last '+
          esc((RV_RANGES.filter(function(r){return r.k===rvRange;})[0]||{}).lab)+' for anyone on the chart.</div>';
      }
      var t0=Infinity,t1=-Infinity,lo=Infinity,hi=-Infinity;
      series.forEach(function(sr){ sr.pts.forEach(function(pt){
        if(pt[0]<t0)t0=pt[0]; if(pt[0]>t1)t1=pt[0];
        if(pt[1]<lo)lo=pt[1]; if(pt[1]>hi)hi=pt[1];
      }); });
      var span=(t1-t0)||1;
      // Same floor under the range as the old chart had, for the same reason: a
      // rating that wandered eight points must not be drawn as a mountain range.
      var mid=(hi+lo)/2, half=Math.max((hi-lo)/2*1.1,30);
      var top=mid+half, bot=mid-half;
      var x0=RV_PADL,x1=RV_W-RV_PADR,y0=RV_PADT,y1=RV_H-RV_PADB;
      var yOf=function(r){ return y1-((r-bot)/((top-bot)||1))*(y1-y0); };

      var edges=[], rough=(top-bot)/5, step=Math.pow(10,Math.floor(Math.log(rough)/Math.LN10));
      [1,2,2.5,5,10].some(function(m){ if(step*m>=rough){ step=step*m; return true; } return false; });
      for(var g=Math.ceil(bot/step)*step; g<top; g+=step) edges.push(g);
      var axis='';
      edges.forEach(function(r){
        var y=yOf(r);
        axis+='<line class="cg" x1="'+x0+'" y1="'+y.toFixed(1)+'" x2="'+x1+'" y2="'+y.toFixed(1)+'"/>'+
          '<text class="ct" text-anchor="end" x="'+(x0-6)+'" y="'+(y+3.5).toFixed(1)+'">'+nf(r)+'</text>';
      });

      var paths='', reg=[];
      rvDrawn={};
      series.forEach(function(sr){
        rvDrawn[sr.id]=true;
        var xy=sr.pts.map(function(pt){ return [x0+((pt[0]-t0)/span)*(x1-x0),yOf(pt[1])]; });
        paths+='<path class="cl s'+sr.ci+'" d="'+xy.map(function(q,j){
          return (j?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1);
        }).join('')+'" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        reg.push({name:sr.name,i:sr.ci,pts:sr.pts.map(function(pt,j){
          return [+xy[j][0].toFixed(1),+xy[j][1].toFixed(1),pt[0],pt[1]];
        })});
      });

      // Dates across a long window, clock times across a short one. "9 Sept"
      // repeated six times is not an axis.
      var ticks='', dayMs=1440, tickAt=function(m,label){
        var tx=x0+((m-t0)/span)*(x1-x0);
        ticks+='<text class="ct dim" text-anchor="middle" x="'+tx.toFixed(1)+'" y="'+(RV_H-9)+'">'+esc(label)+'</text>';
      };
      if(span<=2*dayMs){
        // Snapped to the clock, not to the first reading. Stepping from t0 put
        // the labels at 07:21, 11:21, 15:21 - correct, and unreadable as an
        // axis. Epoch milliseconds divide evenly into these steps, so a multiple
        // of one lands on :00, :15, :30 or :45 wherever the reader is.
        var STEPS=[15,30,60,120,180,240,360,720];
        var stepMin=STEPS[STEPS.length-1];
        for(var si=0;si<STEPS.length;si++){ if(span/STEPS[si]<=8){ stepMin=STEPS[si]; break; } }
        var stepMs=stepMin*60000, a0=mmrBase+t0*60000, a1=mmrBase+t1*60000;
        for(var a=Math.ceil(a0/stepMs)*stepMs; a<=a1; a+=stepMs)
          tickAt((a-mmrBase)/60000,new Date(a).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
      }else{
        var stepDays=Math.max(1,Math.ceil((span/dayMs)/7));
        for(var d=Math.ceil(t0/dayMs)*dayMs; d<=t1; d+=dayMs*stepDays)
          tickAt(d,new Date(mmrBase+d*60000).toLocaleDateString([],{day:'numeric',month:'short'}));
      }
      rvReg={series:reg,w:RV_W};
      return '<div class="chartwrap rvwrap">'+
        '<svg class="chart" viewBox="0 0 '+RV_W+' '+RV_H+'" preserveAspectRatio="xMidYMid meet" role="img" '+
          'aria-label="'+esc(PL_NAME[rvKey]+' rating over the '+chartSpanWords(span)+', '+
            series.map(function(sr){return sr.name;}).join(', '))+'">'+
          axis+paths+
          '<g class="cmark" hidden><line class="cml" y1="'+y0+'" y2="'+y1+'"/></g>'+
          ticks+
        '</svg>'+
        '<div class="chart-tip" hidden></div>'+
      '</div>';
    };

    // The shell is built once. Everything after this repaints only the part that
    // changed, so typing in the search box never rebuilds the input underneath
    // the cursor: the old version re-rendered the whole tab on every keystroke
    // and had to put the caret back by hand afterwards.
    var rvBuilt=false, rvIn=null, rvListEl=null, rvCountEl=null, rvLegEl=null, rvChartEl=null;
    var rvShell=function(){
      if(rvBuilt||!rvEl)return;
      rvEl.innerHTML=
        '<div class="rvhead">'+
          // The window is a stepper rather than four more buttons, the way the
          // board's MMR control steps through playlists: it is one setting with
          // four values, and four abreast made the row read as eight equal
          // choices when only the first three are a choice of what to look at.
          '<div class="wseg rvpl" role="group" aria-label="Playlist and window">'+
            ['ones','twos','threes'].map(function(k){
              return '<button type="button" data-pl="'+k+'" aria-pressed="'+(k===rvKey?'true':'false')+'">'+PL_NAME[k]+'</button>';
            }).join('')+
            '<span class="wsep" aria-hidden="true"></span>'+
            '<button type="button" class="rvrg" data-rgstep title="Click to change how much history is shown">'+
              'Show<span class="mpl" id="rvRg"></span></button>'+
          '</div>'+
          '<div class="rvsearch">'+
            '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" aria-hidden="true">'+
              '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'+
            '<input id="rvFilter" type="text" autocomplete="off" role="combobox" aria-expanded="false" '+
              'aria-controls="rvList" aria-autocomplete="list" placeholder="Add a player to the chart…" '+
              'aria-label="Add a player to the chart">'+
            '<div class="rvlist" id="rvList" role="listbox" aria-label="Players" hidden></div>'+
          '</div>'+
          '<div class="rvcount" id="rvCount"></div>'+
        '</div>'+
        '<div class="rvlegend" id="rvLegend"></div>'+
        '<div id="rvChart"></div>';
      rvIn=document.getElementById('rvFilter');
      rvListEl=document.getElementById('rvList');
      rvCountEl=document.getElementById('rvCount');
      rvLegEl=document.getElementById('rvLegend');
      rvChartEl=document.getElementById('rvChart');
      rvBuilt=true;
    };

    var rvMatches=function(){
      var q=rvFilter.toLowerCase();
      var pool=rvPool().filter(function(p){ return (rvPicked||[]).indexOf(p.id)<0; });
      if(q)pool=pool.filter(function(p){
        return (String(p.name)+' '+String(p.team||'')).toLowerCase().indexOf(q)>=0;
      });
      // Highest rating first, so an empty box is still a useful list rather than
      // whatever order the roster happens to be in.
      return pool.sort(function(a,b){ return (b.mmr&&b.mmr[rvKey]||0)-(a.mmr&&a.mmr[rvKey]||0); });
    };

    var rvPaintList=function(){
      if(!rvListEl)return;
      var full=(rvPicked||[]).length>=RV_MAX;
      if(!rvListOpen){ rvListEl.hidden=true; if(rvIn)rvIn.setAttribute('aria-expanded','false'); return; }
      var rows=rvMatches();
      if(rvCursor>=rows.length)rvCursor=rows.length-1;
      rvListEl.innerHTML=full
        ? '<div class="rvempty">Six lines is the limit. Remove one to add another.</div>'
        : rows.length
          ? rows.map(function(p,i){
              var cur=p.mmr&&p.mmr[rvKey]!=null?nf(p.mmr[rvKey]):'&middot;';
              return '<button type="button" class="rvopt'+(i===rvCursor?' at':'')+'" role="option" '+
                'aria-selected="'+(i===rvCursor?'true':'false')+'" data-id="'+esc(p.id)+'">'+
                '<b>'+esc(p.name)+'</b><i>'+esc(p.team||'Free agent')+'</i><span>'+cur+'</span></button>';
            }).join('')
          : '<div class="rvempty">'+(mmrState!=='done'?'Loading the rating history…':'Nobody left to add by that name.')+'</div>';
      rvListEl.hidden=false;
      if(rvIn)rvIn.setAttribute('aria-expanded','true');
      var at=rvListEl.querySelector('.rvopt.at');
      if(at&&at.scrollIntoView)at.scrollIntoView({block:'nearest'});
    };

    var rvPaintLegend=function(){
      if(!rvLegEl)return;
      var picked=rvPicked||[];
      rvLegEl.innerHTML=picked.length
        ? picked.map(function(id,i){
            var p=rvPlayer(id);
            if(!p)return '';
            var cur=p.mmr&&p.mmr[rvKey]!=null?nf(p.mmr[rvKey]):'&middot;';
            // A name with no line on the chart says so rather than sitting there
            // as a colour the reader cannot find.
            var off=!rvDrawn[id];
            return '<button type="button" class="rvleg s'+(i%RV_MAX)+(off?' off':'')+'" data-id="'+esc(id)+'" '+
              'title="'+(off?'No readings in this window. Click to remove.':'Remove from the chart')+'" '+
              'aria-label="Remove '+esc(p.name)+' from the chart">'+
              '<i></i><b>'+esc(p.name)+'</b><span>'+(off?'no data':cur)+'</span><em>&times;</em></button>';
          }).join('')
        : '<span class="rvnone">No players on the chart yet.</span>';
      if(rvCountEl)rvCountEl.textContent=picked.length+' of '+RV_MAX;
    };

    var rvPaintChart=function(){
      if(rvChartEl)rvChartEl.innerHTML=multiChart(rvPicked||[]);
    };

    var rvRender=function(){
      if(!rvEl)return;
      rvShell();
      rvSeed();
      Array.prototype.forEach.call(rvEl.querySelectorAll('.rvpl button[data-pl]'),function(b){
        b.setAttribute('aria-pressed',b.getAttribute('data-pl')===rvKey?'true':'false');
      });
      var rgEl=document.getElementById('rvRg');
      if(rgEl)rgEl.textContent=(RV_RANGES.filter(function(r){return r.k===rvRange;})[0]||RV_RANGES[0]).lab;
      // Chart first: the legend reports which lines it actually drew.
      rvPaintChart(); rvPaintLegend(); rvPaintList();
      if(typeof syncUrl==='function')syncUrl();
    };

    var rvAdd=function(id){
      if(!rvPicked)rvPicked=[];
      if(rvPicked.indexOf(id)>=0||rvPicked.length>=RV_MAX)return;
      rvTouched=true;
      rvPicked.push(id);
      // The name that was just added is gone from the list, so the query that
      // found it has done its job.
      rvFilter=''; if(rvIn)rvIn.value=''; rvCursor=-1;
      rvPaintChart(); rvPaintLegend(); rvPaintList();
      if(typeof syncUrl==='function')syncUrl();
    };
    var rvRemove=function(id){
      if(!rvPicked)return;
      var at=rvPicked.indexOf(id);
      if(at<0)return;
      rvTouched=true;
      rvPicked.splice(at,1);
      rvPaintChart(); rvPaintLegend(); rvPaintList();
      if(typeof syncUrl==='function')syncUrl();
    };

    if(rvEl){
      rvEl.addEventListener('click',function(e){
        var pl=e.target.closest?e.target.closest('[data-pl]'):null;
        if(pl){ rvKey=pl.getAttribute('data-pl'); rvCursor=-1; rvRender(); return; }
        var rg=e.target.closest?e.target.closest('[data-rgstep]'):null;
        if(rg){
          var at=0;
          RV_RANGES.forEach(function(r,i){ if(r.k===rvRange)at=i; });
          rvRange=RV_RANGES[(at+1)%RV_RANGES.length].k;
          rvRender();
          return;
        }
        var opt=e.target.closest?e.target.closest('.rvopt'):null;
        if(opt){ rvAdd(opt.getAttribute('data-id')); if(rvIn)rvIn.focus(); return; }
        var leg=e.target.closest?e.target.closest('.rvleg'):null;
        if(leg){ rvRemove(leg.getAttribute('data-id')); return; }
      });
      rvEl.addEventListener('input',function(e){
        if(e.target.id!=='rvFilter')return;
        rvFilter=e.target.value.trim();
        rvCursor=rvFilter?0:-1;
        rvListOpen=true;
        rvPaintList();
      });
      rvEl.addEventListener('focusin',function(e){
        if(e.target.id!=='rvFilter')return;
        rvListOpen=true; rvPaintList();
      });
      // A list that stays open over the chart is in the way of the thing the
      // reader just changed, so anything outside the search closes it.
      document.addEventListener('click',function(e){
        if(!rvListOpen)return;
        if(e.target.closest&&e.target.closest('.rvsearch'))return;
        rvListOpen=false; rvPaintList();
      });
      rvEl.addEventListener('keydown',function(e){
        if(e.target.id!=='rvFilter')return;
        if(e.key==='Escape'){ rvListOpen=false; rvPaintList(); return; }
        if(e.key==='Backspace'&&!rvFilter&&(rvPicked||[]).length){
          // Empty box, so backspace means "undo the last one I added", the way
          // every tag field behaves.
          rvRemove(rvPicked[rvPicked.length-1]); return;
        }
        if(e.key!=='ArrowDown'&&e.key!=='ArrowUp'&&e.key!=='Enter')return;
        var rows=rvMatches();
        if(e.key==='Enter'){
          if(rvListOpen&&rvCursor>=0&&rows[rvCursor]){ e.preventDefault(); rvAdd(rows[rvCursor].id); }
          return;
        }
        e.preventDefault();
        if(!rvListOpen){ rvListOpen=true; rvCursor=0; rvPaintList(); return; }
        if(!rows.length)return;
        rvCursor=e.key==='ArrowDown'
          ? (rvCursor+1>=rows.length?0:rvCursor+1)
          : (rvCursor-1<0?rows.length-1:rvCursor-1);
        rvPaintList();
      });
      // The chart's pointer marker: snap to the nearest reading and name every
      // line at that moment. A chart of slow-moving ratings cannot answer
      // "which" and "when" by shape alone.
      rvEl.addEventListener('mousemove',function(e){
        var wrap=e.target.closest?e.target.closest('.chartwrap'):null;
        if(!wrap||!rvReg||!rvReg.series.length)return;
        var svg=wrap.querySelector('svg.chart'), tip=wrap.querySelector('.chart-tip'), mark=wrap.querySelector('.cmark');
        if(!svg||!tip||!mark)return;
        var box=svg.getBoundingClientRect();
        if(!box.width)return;
        var ux=((e.clientX-box.left)/box.width)*rvReg.w;
        var when=null, rows='';
        rvReg.series.forEach(function(sr){
          var best=0,bestD=Infinity;
          for(var i=0;i<sr.pts.length;i++){
            var d=Math.abs(sr.pts[i][0]-ux);
            if(d<bestD){ bestD=d; best=i; }
          }
          var pt=sr.pts[best];
          if(when==null)when=pt[2];
          rows+='<span class="tl s'+sr.i+'"><i></i>'+esc(sr.name)+'<b>'+nf(pt[3])+'</b></span>';
        });
        var w=new Date(mmrBase+when*60000);
        tip.innerHTML='<span class="tw">'+esc(w.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'})+
          ', '+w.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))+'</span>'+rows;
        tip.removeAttribute('hidden');
        mark.removeAttribute('hidden');
        mark.querySelector('.cml').setAttribute('x1',ux.toFixed(1));
        mark.querySelector('.cml').setAttribute('x2',ux.toFixed(1));
        var pct=Math.max(0,Math.min(1,ux/rvReg.w));
        tip.style.left=(pct*box.width)+'px';
        tip.style.transform='translateX('+(pct<.2?'0':pct>.8?'-100%':'-50%')+')';
      });
      rvEl.addEventListener('mouseleave',function(e){
        var wrap=e.target.closest?e.target.closest('.chartwrap'):null;
        if(!wrap)return;
        var mark=wrap.querySelector('.cmark'), tip=wrap.querySelector('.chart-tip');
        if(mark)mark.setAttribute('hidden','');
        if(tip)tip.setAttribute('hidden','');
      },true);
    }
    // The history file is only fetched when this tab is first opened: it is the
    // largest thing the page can ask for and most visitors never come here.
    var rvOpen=function(){
      rvRender();
      if(mmrState!=='done')loadMmrHistory(rvRender);
    };

    // ---- the view, in the address bar ----
    //
    // A link should open the board the person sharing it was actually looking
    // at. Everything the controls change goes in the query string, and only
    // when it differs from the default, so an untouched board stays at a bare
    // 198x.online/ rather than carrying eight parameters that all say 'normal'.
    //
    // replaceState rather than pushState: these chips read as filters, not as
    // pages, and one history entry per tap would make the back button walk out
    // of the board a step at a time instead of leaving the site.
    //
    // The values are words, not the internal sort keys. g14 is a leftover from
    // when that column was 14 days and would now be a lie in a place people
    // read; sg and ht mean nothing on sight.
    var SORT_URL={ones:'mmr',twos:'mmr',threes:'mmr',sg:'season',g14:'games',h2:'hours',ht:'totalhours',name:'name',region:'region',status:'status'};
    var URL_SORT={mmr:'twos',season:'sg',games:'g14',hours:'h2',totalhours:'ht',name:'name',region:'region',status:'status'};
    // Matches what buildTable picks for a fresh column, so a direction only
    // appears in the link when it is not the one a click would have given.
    var NAT_DIR={name:'asc',region:'asc',status:'asc'};
    var natDir=function(k){ return NAT_DIR[k]||'desc'; };
    var isTeams=function(){ return tabNow==='teams'; };
    // Nothing is written until the incoming link has been read, or the first
    // paint would overwrite the parameters it is about to apply.
    var urlReady=false;

    syncUrl=function(){
      if(!urlReady||!window.history||!history.replaceState)return;
      var q=[];
      // The ratings tab has no ordering, no region and no search, so it
      // carries only what it actually shows: the playlist and the lines.
      if(tabNow==='ratings'){
        q.push('tab=ratings');
        if(rvKey!=='twos')q.push('pl='+rvKey);
        if(rvRange!=='all')q.push('range='+rvRange);
        var names=(rvPicked||[]).map(function(id){
          var pp=players.filter(function(x){return x.id===id;})[0];
          return pp?pp.name:null;
        }).filter(Boolean);
        if(names.length)q.push('who='+encodeURIComponent(names.join(',')));
        var rnext=location.pathname+(q.length?('?'+q.join('&')):'')+location.hash;
        if(rnext!==location.pathname+location.search+location.hash){
          try{ history.replaceState(null,'',rnext); }catch(e){}
        }
        return;
      }
      var teamsOn=isTeams(), paint=teamsOn?paintT:paintP;
      var k=paint.sortKey(), d=paint.sortDir();
      var isMmr=(k==='ones'||k==='twos'||k==='threes');
      if(teamsOn)q.push('tab=teams');
      // 2v2 MMR descending is what a bare URL already means.
      if(SORT_URL[k]&&!(isMmr&&k==='twos'&&d==='desc'))q.push('sort='+SORT_URL[k]);
      if(isMmr&&k!=='twos')q.push('mmr='+k);
      if(d!==natDir(k))q.push('dir='+d);
      // Skipped on the teams tab, where the window control is hidden and the
      // 24h column is fixed: a link has to describe what is on screen, and
      // win=d7 there would describe something the recipient cannot see.
      if(win!=='d1'&&!teamsOn)q.push('win='+win);
      if(regionQ)q.push('region='+encodeURIComponent(regionQ));
      if(searchQ)q.push('q='+encodeURIComponent(searchQ));
      if(liveOnly)q.push('playing=1');
      var next=location.pathname+(q.length?('?'+q.join('&')):'')+location.hash;
      if(next===location.pathname+location.search+location.hash)return;
      // Safari throws once replaceState is called more than 100 times in 30
      // seconds, which a held-down backspace in the search box can reach. The
      // address bar falling behind is not worth breaking the handler over.
      try{ history.replaceState(null,'',next); }catch(e){}
    };

    // A parameter that is missing, misspelt or impossible is ignored rather
    // than obeyed: ?region=XX should open the normal board, not an empty one.
    var applyUrl=function(){
      var sp;
      try{ sp=new URLSearchParams(location.search); }catch(e){ return; }
      var get=function(n){ var v=sp.get(n); return v==null?'':String(v).trim(); };

      var tab=get('tab').toLowerCase();
      if(tab==='teams')show('teams');

      if(tab==='ratings'){
        var pl=get('pl').toLowerCase();
        if(pl==='ones'||pl==='twos'||pl==='threes')rvKey=pl;
        var rg=get('range').toLowerCase();
        if(RV_RANGES.filter(function(r){return r.k===rg;}).length)rvRange=rg;
        var who=get('who').split(',').slice(0,RV_MAX);
        var wantIds=[];
        who.forEach(function(nm){
          nm=nm.trim(); if(!nm)return;
          var pp=players.filter(function(x){return x.name===nm;})[0];
          if(pp&&wantIds.indexOf(pp.id)<0)wantIds.push(pp.id);
        });
        // An empty or unrecognised list falls back to the default three
        // rather than opening an empty chart.
        if(wantIds.length)rvPicked=wantIds;
        show('ratings');
      }

      var w=get('win').toLowerCase();
      if(w==='d1'||w==='d7'){
        win=w;
        var th=pv.querySelector('th.c-g14 span'); if(th)th.textContent=COL_LABEL[win];
      }

      var m=get('mmr').toLowerCase();
      if(m==='ones'||m==='twos'||m==='threes'){ mmrKey=m; showMmrPlaylist(); }

      // Checked against the regions actually on the board, not a fixed list, so
      // a region nobody plays in cannot empty the table.
      var r=get('region').toUpperCase();
      if(r&&players.filter(function(p){return p.region===r;}).length){ regionQ=r; buildRegions(); }

      // Capped: the search is a filter, not a place to park a paragraph.
      var qs=get('q').slice(0,60);
      if(qs){ input.value=qs; searchQ=qs.toLowerCase(); wrap.classList.add('has'); }

      // Only honoured while somebody is on the ladder. buildPlaying drops the
      // filter when nobody is, and a link that arrives at a quiet hour would
      // otherwise show an empty board with no control to undo it.
      if(get('playing')==='1'&&playingSeg&&!playingSeg.hidden){ liveOnly=true; buildPlaying(); }

      var sk=URL_SORT[get('sort').toLowerCase()];
      if(sk==='twos')sk=mmrKey; // 'mmr' means whichever playlist is selected
      var d=get('dir').toLowerCase(); if(d!=='asc'&&d!=='desc')d='';
      if(sk){
        var dir=d||natDir(sk);
        if(isTeams()){ if(tAcc[sk])paintT.setSort(sk,dir); }
        else if(pAcc[sk]){ markMetric(sk); paintP.setSort(sk,dir); }
      }

      markMetric(paintP.sortKey());
      renderPodium(); paintP(); paintT();
      if(tabNow==='ratings')rvRender();
      // Writing straight back tidies the link as well as recording it: an
      // unknown value drops out, and a parameter that spells out the default
      // disappears.
      urlReady=true; syncUrl();
    };
    applyUrl();

    // ---- feedback -> posted to the Worker, which files the GitHub issue ----
    // The site is static, so it cannot hold a token; the Worker holds it and
    // this just posts JSON. Falls back to opening a prefilled issue if the
    // Worker is unreachable, so feedback is never simply lost.
    var FB_ENDPOINT=window.__FB_ENDPOINT__||'/feedback';
    var REPO='https://github.com/Bordder/RLProTracker';
    // A floor and a ceiling on the message, both mirrored server-side in
    // functions/feedback.js because anything can post to that endpoint directly.
    //
    // 500 rather than the old 2000: a symptom, a device and a repro step fit in
    // it, and it bounds what an abusive body costs to parse. 25 rather than
    // nothing: it turns away "gg" and "nice site" without reaching far enough to
    // catch a real report, the shortest useful ones running around 35 characters
    // ("Vatira's MMR looks about 200 too low").
    var FB_MIN=25, FB_MAX=500;
    var fb=document.getElementById('fbForm');
    if(fb){
      var fbRes=document.getElementById('fbResult');
      var fbBtn=document.getElementById('fbBtn');
      var fbMsgEl=document.getElementById('fbMsg');
      var fbCount=document.getElementById('fbCount');
      // A hard cap with no counter is how someone loses a paragraph they just
      // typed, and a floor with no counter is a submit that fails for no visible
      // reason. Say where they are the whole way.
      var paintCount=function(){
        var n=(fbMsgEl.value||'').trim().length;
        var need=FB_MIN-n;
        fbCount.className='count'+(n===0?'':(need>0?' short':(n>=FB_MAX?' full':'')));
        fbCount.textContent=n===0?'':(need>0?(need+' more character'+(need===1?'':'s')):(n+' / '+FB_MAX));
      };
      fbMsgEl.addEventListener('input',paintCount);
      paintCount();
      fb.addEventListener('submit',function(e){
        e.preventDefault();
        var hp=document.getElementById('fbHp').value;
        var user=(document.getElementById('fbUser').value||'').trim().slice(0,60);
        var type=document.getElementById('fbType').value;
        var msg=(fbMsgEl.value||'').trim().slice(0,FB_MAX);
        if(!msg){ fbRes.textContent='Add a message first.'; fbRes.className='msg err'; fbMsgEl.focus(); return; }
        if(msg.length<FB_MIN){ fbRes.textContent='A little more detail please, at least '+FB_MIN+' characters.'; fbRes.className='msg err'; fbMsgEl.focus(); return; }
        fbBtn.disabled=true;
        fbRes.textContent='Sending…'; fbRes.className='msg';
        fetch(FB_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({user:user,type:type,message:msg,hp:hp})})
          .then(function(r){ if(!r.ok)throw new Error('http '+r.status); return r.json(); })
          .then(function(){
            fbRes.textContent='Sent. Thanks!'; fbRes.className='msg ok'; fb.reset(); paintCount();
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
