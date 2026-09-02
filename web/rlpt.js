(function(){
  "use strict";
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});};
  var nf=function(n){return n==null?null:Number(n).toLocaleString('en-US');};
  var hf=function(n){return n==null?null:Number(n).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});};
  var initials=function(s){s=String(s||'').trim();if(!s)return'?';var p=s.split(/[\s\-_.]+/).filter(Boolean);return (p.length>1?(p[0][0]+p[1][0]):s.slice(0,2)).toUpperCase();};
  var tierClass=function(v){if(v==null)return'';if(v<1115)return't-low';if(v<1435)return't-champ';if(v<1855)return't-gc';return't-ssl';};
  var tierName=function(v){if(v==null)return'';if(v<1115)return'';if(v<1435)return'Champion';if(v<1855)return'Grand Champion';return'Supersonic Legend';};
  var mmrCell=function(v){return v==null?'<td class="c-mmr"><span class="dash">&middot;</span></td>':'<td class="c-mmr"><span class="mv '+tierClass(v)+'">'+nf(v)+'</span></td>';};
  var fmtGames=function(gs,win){ var g=gs?gs[win]:null; if(!g||g.games==null)return'<span class="dash">&middot;</span>'; if(g.partial)return'<span class="pending">pending</span>'; if(g.games===0)return'<span class="mv">0</span>'; return'<span class="g14v">'+nf(g.games)+'</span>'; };
  var WIN_LABEL={d1:'24h',d7:'7d',d14:'14d'};
  // Short chip labels, with the full meaning kept on hover.
  var STATUS_LABEL={'hidden-details':'hidden','no-steam-id':'no steam','no-steam-link':'no steam'};
  var STATUS_HINT={
    'public':'Steam profile is public, so playtime hours are available.',
    'hidden-details':'Profile is visible but the game details section is switched off, so Steam does not publish playtime.',
    'private':'Steam profile is closed to the public, so no playtime is available.',
    'no-steam-id':'No Steam account matched for this player.',
    'no-steam-link':'No Steam account matched for this player.',
    'unknown':'Steam did not return a profile state for this player.'
  };
  var statusChip=function(s){
    if(!s)return'<span class="dash">&middot;</span>';
    var k=String(s).toLowerCase(),cls='';
    if(/public|active|online|grind/.test(k))cls='sx-live';
    else if(/priv|hidden|limit/.test(k))cls='sx-priv';
    else if(/no-steam|unknown|error|none|idle|offline/.test(k))cls='sx-off';
    var isErr=k.indexOf('error')===0;
    var label=isErr?'steam err':(STATUS_LABEL[k]||s);
    var hint=isErr?'Steam returned an error for this player on the last check.':(STATUS_HINT[k]||'');
    return'<span class="sx '+cls+'"'+(hint?' title="'+esc(hint)+'"':'')+'>'+esc(label)+'</span>';
  };
  var rankMark=function(r){ if(!r)return'<span class="rknum">&middot;</span>'; return'<span class="rknum'+(r<=3?' t'+r:'')+'">'+String(r).padStart(2,'0')+'</span>'; };

  // Total playtime, flagged when it is a stored reading from before the profile closed.
  var totalHoursCell=function(p){
    if(p.totalHours==null)return'<span class="dash">&middot;</span>';
    var v=nf(Math.round(p.totalHours));
    if(!p.totalFrozenAt)return v;
    var d=new Date(p.totalFrozenAt);
    var on=isNaN(d)?'an earlier check':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    return'<span class="frozen" title="Last reading before this profile was closed, taken '+esc(on)+'. It cannot update while the profile stays private.">'+v+'</span>';
  };
  // The 2-week hours cell. A Steam reading renders plainly; a presence-derived
  // estimate renders as ~N with a dotted underline and an explanation on hover,
  // so the two can never be read as the same kind of number.
  var hours2wkCell=function(p){
    if(p.hours2wk!=null)return hf(p.hours2wk);
    if(p.estHours2wk!=null){
      return '<span class="est" title="Estimated, not measured. This profile hides its playtime, so hours are reconstructed by checking every few minutes whether the player is in Rocket League. It undercounts - any session between checks is missed - and it only covers time since tracking began.">'+hf(p.estHours2wk)+'</span>';
    }
    return '<span class="dash">&middot;</span>';
  };

  // Region by team's RLCS competitive region (may differ from a player's nationality).
  var REGION={
    'Karmine Corp':'EU','Gentle Mates':'EU','Team Vitality':'EU','Ninjas in Pyjamas':'EU','Man City Esports':'EU',
    'NRG':'NA','Shopify Rebellion':'NA','Spacestation Gaming':'NA','Wildcard':'NA','TSM':'NA','FUT Esports':'NA','Virtus.pro':'NA',
    'MIBR':'SAM','FURIA':'SAM','Mate y Tapa':'SAM','Bigodes':'SAM',
    'Twisted Minds':'MENA','Team Falcons':'MENA','R8 Esports':'MENA',
    'Five Fears':'OCE'
  };
  var REGION_CLASS={EU:'rg-eu',NA:'rg-na',SAM:'rg-sam',MENA:'rg-mena',OCE:'rg-oce',APAC:'rg-apac'};

  // ---- Team marks -------------------------------------------------------
  // Drop a file at web/img/teams/<slug>.<ext> and list its extension here to
  // use a real org logo; anything not listed falls back to a tinted monogram.
  // Slugs come from teamSlug() below, e.g. "Ninjas in Pyjamas" -> ninjas-in-pyjamas.
  // Per-logo inset override in px (default 3, set in CSS). A few marks are
  // supplied tight-cropped, with the artwork running to the edge of its own
  // file: Virtus.pro's shield fills its whole bounding box, so at the shared
  // inset it renders noticeably larger than marks that carry their own
  // whitespace. Nudging those individually keeps optical size consistent.
  var LOGO_INSET={'virtuspro':6};
  var TEAM_LOGO={'karmine-corp':'png','gentle-mates':'png','team-vitality':'png','ninjas-in-pyjamas':'png','man-city-esports':'png','nrg':'png','shopify-rebellion':'png','spacestation-gaming':'png','mibr':'png','furia':'png','twisted-minds':'png','wildcard':'png','virtuspro':'png','team-falcons':'png','tsm':'png','five-fears':'png','r8-esports':'png','fut-esports':'png'};
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
    // The monogram is always rendered; a logo, when there is one, covers it.
    return '<span class="'+cls+(ext?' logo':'')+'" style="'+style+'" aria-hidden="true">'+esc(initials(name))+
      (ext?'<img src="'+esc(LOGO_DIR+slug+'.'+ext)+'" alt="" loading="lazy" decoding="async"'+
        (LOGO_INSET[slug]?' style="padding:'+LOGO_INSET[slug]+'px"':'')+'>':'')+'</span>';
  };
  var regionChip=function(r){ return r?'<span class="rg '+(REGION_CLASS[r]||'')+'">'+esc(r)+'</span>':'<span class="dash">&middot;</span>'; };

  var DATA_BASE=window.__DATA_BASE__||"./data/derived";
  // raw.githubusercontent.com sends Cache-Control: max-age=300, so a plain fetch
  // can hand back data five minutes old - and a tab left open would never see
  // anything newer at all. The collector writes every ~3 minutes, so bust the
  // cache on a 60s bucket: fresh enough to matter, coarse enough that repeat
  // visitors within the same minute still get a cache hit.
  var getJson=function(f){
    var bust='?v='+Math.floor(Date.now()/60000);
    return fetch(DATA_BASE+'/'+f+bust,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});
  };
  var load=window.__RLDATA__
    ? Promise.resolve([window.__RLDATA__.steam,window.__RLDATA__.teams,window.__RLDATA__.tracker,window.__RLDATA__.teamTracker,window.__RLDATA__.presence])
    : Promise.all([getJson('steam-hours.json'),getJson('team-hours.json'),getJson('tracker.json'),getJson('team-tracker.json'),getJson('presence-hours.json')]);

  load.then(function(res){
    var steam=res[0], teamH=res[1], tracker=res[2], teamT=res[3], presence=res[4];
    if(!steam||!teamH){ document.getElementById('playersView').innerHTML='<div class="scroll"><div class="empty">Failed to load data</div></div>'; return; }

    // ---- merge into unified models ----
    var trById={}; (tracker&&tracker.players||[]).forEach(function(p){trById[p.id]=p;});
    // Presence hours are only ever a fallback. Where Steam publishes playtime we
    // use that; where it does not, polling who is in-game reconstructs a rough
    // figure. d14 matches the 2-week window the Steam column shows.
    var presById={}; (presence&&presence.players||[]).forEach(function(p){presById[p.id]=p;});
    var players=steam.players.map(function(p){
      var t=trById[p.id]||{};
      return { name:p.name, team:p.team, region:REGION[p.team]||null, status:p.status,
        mmr:(t.mmr&&t.mmr.twos!=null)?t.mmr:(t.mmr||null),
        hasMmr:!!(t.mmr&&(t.mmr.ones!=null||t.mmr.twos!=null||t.mmr.threes!=null)),
        seasonGames:t.seasonGames?t.seasonGames.total:null,
        games:t.games?t.games.total:null,
        updatedAt:(function(){var v=t.updatedAt?Date.parse(t.updatedAt):NaN;return isNaN(v)?null:v;})(),
        hours2wk:p.steam2wkHours,
        estHours2wk:(function(){
          if(p.steam2wkHours!=null)return null; // never shadow a measured reading
          var e=presById[p.id];
          return (e&&e.presenceHours&&e.presenceHours.d14)?e.presenceHours.d14:null;
        })(),
        totalHours:p.totalHours, totalFrozenAt:p.totalHoursFrozenAt||null };
    });
    var ttByTeam={}; (teamT&&teamT.teams||[]).forEach(function(t){ttByTeam[t.team]=t;});
    var teams=teamH.teams.map(function(t){
      var tt=ttByTeam[t.team]||{};
      return { team:t.team, region:REGION[t.team]||null, players:t.players, tracked:t.tracked, ranked:tt.ranked||0,
        avgMmr:tt.avgMmr||null, seasonGames:tt.seasonGames!=null?tt.seasonGames:null,
        hours2wk:t.steam2wkHours, totalHours:t.totalHours };
    });

    assignTeamHues(teams.map(function(t){return t.team;}).concat(players.map(function(p){return p.team;})));

    // A logo that fails to load drops back to the monogram underneath it.
    // Capture phase: img error events do not bubble.
    document.addEventListener('error',function(e){
      var img=e.target;
      if(img&&img.tagName==='IMG'&&img.parentNode&&img.parentNode.classList.contains('logo')){
        img.parentNode.classList.remove('logo');
        img.parentNode.removeChild(img);
      }
    },true);

    // ---- rank by 2v2 MMR (players by their twos, teams by avg twos) ----
    var assignRank=function(arr,key){ arr.filter(function(x){return key(x)!=null;}).sort(function(a,b){return key(b)-key(a);}).forEach(function(x,i){x.__rank=i+1;}); };
    assignRank(players,function(p){return p.mmr?p.mmr.twos:null;});
    assignRank(teams,function(t){return t.avgMmr?t.avgMmr.twos:null;});

    // ---- stat cards (Grind dashboard summary) ----
    var ranked=players.filter(function(p){return p.hasMmr;});
    var totalGames=players.reduce(function(a,p){return a+(p.seasonGames||0);},0);
    var top=players.filter(function(p){return p.seasonGames!=null;}).sort(function(a,b){return b.seasonGames-a.seasonGames;})[0];
    var avg2v2=ranked.length?Math.round(ranked.reduce(function(a,p){return a+(p.mmr.twos||0);},0)/ranked.filter(function(p){return p.mmr.twos!=null;}).length):null;
    var rankedTeams=teams.filter(function(t){return t.ranked>0;}).length;
    var card=function(k,v,s,hot){return '<div class="card'+(hot?' hot':'')+'"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>';};
    document.getElementById('stats').innerHTML=
      card('Players Ranked', ranked.length+' <small>/ '+players.length+'</small>', 'pros with ranked data', false)+
      card('Total Ranked Games', nf(totalGames)+' <small>games</small>', 'this season, across all tracked pros', false)+
      card('Most Active This Season', top?(nf(top.seasonGames)+' <small>games</small>'):'&middot;', top?('<b>'+esc(top.name)+'</b> &middot; '+esc(top.team||'')):'no data yet', true)+
      card('Avg 2v2 MMR', avg2v2!=null?nf(avg2v2):'&middot;', avg2v2!=null?('average of '+ranked.length+' pros'):'no data yet', false)+
      card('Teams', rankedTeams+' <small>/ '+teams.length+'</small>', 'with ranked players', false);

    // ---- updated + footnote ----
    var upd=(function(){var iso=(tracker&&tracker.computedAt)||steam.computedAt;var d=iso?new Date(iso):null;return (d&&!isNaN(d))?('updated '+d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})):'live';})();
    document.getElementById('updated').textContent=upd;
    document.getElementById('footNote').innerHTML=
      '<p><b>Three public sources.</b> Ranks and games played come from each player’s public Rocket League Tracker profile. Playtime hours come from the Steam Web API. Rosters come from Liquipedia.</p>'+
      '<p><b>The two Steam privacy settings.</b> Both affect what this page can show, in different ways:</p>'+
      '<ul class="deflist">'+
        '<li><b>Private</b> closes the profile to the public. Nothing on it can be read from outside, playtime included.</li>'+
        '<li><b>Hidden</b> keeps the profile itself open, but switches off the game details section within it. The profile still loads normally for anyone visiting; the playtime figures are simply not published.</li>'+
      '</ul>'+
      '<p>Either setting stops Steam publishing playtime, so <b>Total h</b> is left blank rather than filled with a guess. Ranks and games played come from a separate source and are unaffected, which is why a player can show a full set of MMR numbers with no total hours at all.</p>'+
      '<p><b>Estimated hours.</b> Steam still reveals what someone is playing right now even when it hides how long they have played. So for those profiles the site checks every few minutes and, when it finds them in Rocket League, credits the time since the last check. Those figures appear in <b>2wk h</b> as <span class="est">a tilde and a dotted underline</span>, and they are an undercount by nature: any session that starts and ends between two checks is invisible, and nothing before tracking began is counted. Treat them as a floor, not a measurement. A plain number in that column is Steam&rsquo;s own.</p>'+
      '<p><b>Readings that stop moving.</b> Players do sometimes open a profile that was closed before. When that happens the total playtime is recorded and kept, so if they close it again the number stays on the page instead of vanishing. It is frozen at that point: real, but stuck at whatever it read on the day it was captured, and unable to move again until the profile reopens. Those totals are marked with <span class="frozen">an asterisk</span> and the date is on hover. The 2-week column is deliberately not carried over, because it measures a rolling fortnight and an old value would read as recent activity when it is nothing of the sort.</p>'+
      '<p><b>How current this is.</b> Every player on the board is re-checked every few minutes, all of them on the same cycle, so no row is fresher than another. The timestamp at the top of the page is the last time the numbers were collected. Ranked stats only move when a match ends, and a match plus queue runs about seven minutes, so a figure a few minutes old is as live as this data gets.</p>'+
      '<p><b>Early days.</b> This is a new project and still a work in progress, so expect the occasional rough edge or a number that looks off. Regions follow each team’s competitive region rather than nationality, so a player living elsewhere still carries their team’s region. If something looks wrong, the form below is the fastest way to tell me.</p>';

    // ---- sortable + searchable feed ----
    var pv=document.getElementById('playersView'), tv=document.getElementById('teamsView');
    var searchQ='';

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
        var arr=items.filter(function(x){return !searchQ||matchFn(x,searchQ);});
        var acc=accessors[sk];
        if(acc){ arr=arr.slice().sort(function(a,b){
          var av=acc(a),bv=acc(b),an=(av==null||av===''),bn=(bv==null||bv==='');
          if(an&&bn)return 0; if(an)return 1; if(bn)return -1;
          if(typeof av==='string')return sd==='asc'?av.localeCompare(bv):bv.localeCompare(av);
          return sd==='asc'?(av-bv):(bv-av);
        }); }
        tb.innerHTML=arr.length?arr.map(rowFn).join(''):'<tr><td colspan="'+columns.length+'" class="empty" style="height:auto">No matches</td></tr>';
        trh.querySelectorAll('th').forEach(function(th){ th.classList.remove('s-asc','s-desc'); if(th.dataset.k===sk)th.classList.add(sd==='asc'?'s-asc':'s-desc'); });
      }
      scroll.appendChild(tbl); mount.innerHTML=''; mount.appendChild(scroll);
      paint();
      return paint;
    }

    var win='d1'; // recent-games window: d1 (24h, live now) / d7 / d14
    var pCols=[{label:'#',cls:'c-rk'},{label:'Player',cls:'c-who',k:'name'},{label:'Region',cls:'c-rg',k:'region'},{label:'Status',cls:'c-st',k:'status'},{label:'1v1',cls:'c-mmr',k:'ones',num:true},{label:'2v2',cls:'c-mmr',k:'twos',num:true},{label:'3v3',cls:'c-mmr',k:'threes',num:true},{label:'Games',cls:'c-sg',k:'sg',num:true,title:'Total ranked games played since the current competitive season began'},{label:WIN_LABEL[win],cls:'c-g14',k:'g14',num:true},{label:'2wk h',cls:'c-hr',k:'h2',num:true},{label:'Total h',cls:'c-hr',k:'ht',num:true}];
    var pAcc={name:function(p){return(p.name||'').toLowerCase();},region:function(p){return p.region||null;},status:function(p){return p.status?String(p.status).toLowerCase():null;},ones:function(p){return p.mmr?p.mmr.ones:null;},twos:function(p){return p.mmr?p.mmr.twos:null;},threes:function(p){return p.mmr?p.mmr.threes:null;},sg:function(p){return p.seasonGames;},g14:function(p){return p.games&&p.games[win]?p.games[win].games:null;},h2:function(p){return p.hours2wk!=null?p.hours2wk:p.estHours2wk;},ht:function(p){return p.totalHours;}};
    var playerRow=function(p){
      var mmr=p.hasMmr?(mmrCell(p.mmr.ones)+mmrCell(p.mmr.twos)+mmrCell(p.mmr.threes)):'<td class="c-mmr norank" colspan="3">no ranked data</td>';
      return '<tr class="'+(p.hasMmr?'':'isnorank')+'">'+
        '<td class="c-rk">'+rankMark(p.__rank)+'</td>'+
        '<td class="c-who">'+teamMark(p.team)+'<span class="nm"><b>'+esc(p.name)+'</b><i>'+esc(p.team||'Free agent')+'</i></span></td>'+
        '<td class="c-rg">'+regionChip(p.region)+'</td>'+
        '<td class="c-st">'+statusChip(p.status)+'</td>'+mmr+
        '<td class="c-sg">'+(p.seasonGames!=null?'<span class="sgv">'+nf(p.seasonGames)+'</span>':'<span class="dash">&middot;</span>')+'</td>'+
        '<td class="c-g14">'+fmtGames(p.games,win)+'</td>'+
        '<td class="c-hr">'+hours2wkCell(p)+'</td>'+
        '<td class="c-hr">'+totalHoursCell(p)+'</td>'+
        '</tr>';
    };
    var pMatch=function(p,q){return (String(p.name||'')+' '+String(p.team||'')+' '+String(p.region||'')).toLowerCase().indexOf(q)>=0;};

    var tCols=[{label:'#',cls:'c-rk'},{label:'Team',cls:'c-who',k:'name'},{label:'Region',cls:'c-rg',k:'region'},{label:'',cls:'c-fill'},{label:'Avg 1v1',cls:'c-mmr',k:'ones',num:true},{label:'Avg 2v2',cls:'c-mmr',k:'twos',num:true},{label:'Avg 3v3',cls:'c-mmr',k:'threes',num:true},{label:'Games',cls:'c-sg',k:'sg',num:true,title:'Total ranked games played by the roster since the current competitive season began'},{label:'2wk h',cls:'c-hr',k:'h2',num:true},{label:'Total h',cls:'c-hr',k:'ht',num:true}];
    var tAcc={name:function(t){return(t.team||'').toLowerCase();},region:function(t){return t.region||null;},ones:function(t){return t.avgMmr?t.avgMmr.ones:null;},twos:function(t){return t.avgMmr?t.avgMmr.twos:null;},threes:function(t){return t.avgMmr?t.avgMmr.threes:null;},sg:function(t){return t.seasonGames;},h2:function(t){return t.hours2wk;},ht:function(t){return t.totalHours;}};
    var teamRow=function(t){
      var a=t.avgMmr||{};
      return '<tr class="team-row '+(t.ranked?'':'isnorank')+'" data-team="'+esc(t.team)+'" tabindex="0" aria-expanded="false">'+
        '<td class="c-rk">'+rankMark(t.__rank)+'</td>'+
        '<td class="c-who">'+teamMark(t.team,'tm')+'<span class="nm"><b>'+esc(t.team)+'</b></span></td>'+
        '<td class="c-rg">'+regionChip(t.region)+'</td>'+
        '<td class="c-fill"></td>'+
        mmrCell(a.ones)+mmrCell(a.twos)+mmrCell(a.threes)+
        '<td class="c-sg">'+(t.seasonGames!=null?'<span class="sgv">'+nf(t.seasonGames)+'</span>':'<span class="dash">&middot;</span>')+'</td>'+
        '<td class="c-hr">'+(t.hours2wk!=null?hf(t.hours2wk):'<span class="dash">&middot;</span>')+'</td>'+
        '<td class="c-hr">'+(t.totalHours!=null?nf(Math.round(t.totalHours)):'<span class="dash">&middot;</span>')+'</td></tr>';
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
        {label:'Total h',val:function(p){return p.totalHours!=null?Math.round(p.totalHours):null;},fmt:function(v){return '<span class="c-hr" style="display:inline">'+nf(v)+'</span>';}}
      ];
      // Best value per column, so each metric highlights its leader.
      var bests=METRICS.map(function(m){ var b=null; roster.forEach(function(p){ var v=m.val(p); if(v!=null&&(b==null||v>b))b=v; }); return b; });
      var head='<tr><th class="pl">Player</th>'+METRICS.map(function(m){return '<th>'+m.label+'</th>';}).join('')+'</tr>';
      var body=roster.map(function(p){
        return '<tr><td class="pl">'+esc(p.name)+'</td>'+METRICS.map(function(m,i){
          var v=m.val(p);
          return '<td'+(v!=null&&v===bests[i]?' class="best"':'')+'>'+(v!=null?m.fmt(v):'&middot;')+'</td>';
        }).join('')+'</tr>';
      }).join('');
      return '<div class="exp-wrap"><div class="exp-h">Roster comparison</div><div class="scroll" style="border-radius:8px"><table class="mini"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></div>';
    };

    var paintP=buildTable(pv,pCols,players,pAcc,playerRow,{k:'twos',dir:'desc'},pMatch);
    var paintT=buildTable(tv,tCols,teams,tAcc,teamRow,{k:'twos',dir:'desc'},tMatch);

    // ---- team drilldown: click a team to compare its roster; only one open at a time ----
    var toggleTeam=function(tr){
      if(!tr||!tv.contains(tr))return;
      var open=tv.querySelector('tr.exp-row');
      var same=open&&open.previousElementSibling===tr;
      if(open){ open.parentNode.removeChild(open); }
      var prev=tv.querySelector('tr.team-row.open'); if(prev){ prev.classList.remove('open'); prev.setAttribute('aria-expanded','false'); }
      if(same)return;
      tr.classList.add('open'); tr.setAttribute('aria-expanded','true');
      var exp=document.createElement('tr'); exp.className='exp-row';
      exp.innerHTML='<td colspan="'+tCols.length+'">'+teamPanel(tr.getAttribute('data-team'))+'</td>';
      tr.parentNode.insertBefore(exp,tr.nextSibling);
    };
    tv.addEventListener('click',function(e){ var tr=e.target.closest?e.target.closest('tr.team-row'):null; if(tr)toggleTeam(tr); });
    tv.addEventListener('keydown',function(e){ if(e.key!=='Enter'&&e.key!==' ')return; var tr=e.target.closest?e.target.closest('tr.team-row'):null; if(tr){ e.preventDefault(); toggleTeam(tr); } });

    // ---- recent-games window toggle (24h is live; 7d/14d fill over time) ----
    var winBtns=document.querySelectorAll('#wrow .wseg button');
    var setWin=function(w){
      win=w;
      Array.prototype.forEach.call(winBtns,function(b){b.setAttribute('aria-pressed',b.dataset.w===w?'true':'false');});
      var th=pv.querySelector('th.c-g14 span'); if(th)th.textContent=WIN_LABEL[w];
      paintP();
    };
    Array.prototype.forEach.call(winBtns,function(b){b.addEventListener('click',function(){setWin(b.dataset.w);});});
    setWin('d1');

    // ---- search ----
    var input=document.getElementById('search'), wrap=document.getElementById('searchWrap');
    input.addEventListener('input',function(){ searchQ=input.value.trim().toLowerCase(); wrap.classList.toggle('has',!!searchQ); paintP(); paintT(); });
    document.getElementById('searchClear').addEventListener('click',function(){ input.value=''; searchQ=''; wrap.classList.remove('has'); paintP(); paintT(); input.focus(); });

    // ---- view toggle ----
    var tabP=document.getElementById('tabPlayers'), tabT=document.getElementById('tabTeams');
    var wrowEl=document.getElementById('wrow');
    var show=function(isP){ tabP.setAttribute('aria-selected',isP?'true':'false'); tabT.setAttribute('aria-selected',isP?'false':'true'); pv.hidden=!isP; tv.hidden=isP; if(wrowEl)wrowEl.style.display=isP?'':'none'; };
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

    var yr=document.getElementById('yr'); if(yr)yr.textContent=String(new Date().getFullYear());
  });
})();
