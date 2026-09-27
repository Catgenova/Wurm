import{A as e,Bn as t,Bt as n,Dr as r,Er as i,F as a,Fr as o,Hn as s,It as ee,Ln as c,M as l,Mn as u,Nn as d,O as te,Pn as f,Pt as ne,Rn as p,Rt as re,St as ie,U as ae,Vn as m,W as h,Z as g,Zn as oe,Zt as se,_n as ce,_t as le,bt as ue,ci as de,dr as fe,en as pe,er as me,gt as he,ht as ge,ir as _e,jr as ve,k as ye,li as be,nr as xe,ot as Se,pi as Ce,qt as we,sr as _,ut as Te,vt as Ee,wn as De,wr as Oe,wt as ke,xt as Ae,yn as je,yt as Me,zn as v,zt as Ne}from"./supabase.js";import{$ as y,$a as Pe,$i as Fe,$t as Ie,Ai as Le,An as Re,Ar as ze,At as Be,Ba as Ve,Bt as He,Ci as Ue,Ct as b,Dt as We,En as Ge,Es as Ke,Et as qe,F as Je,Fi as Ye,Fn as Xe,G as Ze,Ga as Qe,Gi as $e,Gn as et,Gr as tt,Hi as nt,Ia as rt,Ir as it,J as at,Ji as ot,Jn as st,Jt as ct,K as lt,Ka as x,Ki as ut,Kn as dt,Ko as ft,La as pt,Li as mt,Mi as ht,Mn as gt,Mo as S,Mt as _t,Ni as vt,Nt as yt,Ot as bt,P as C,Pi as xt,Pt as St,Q as Ct,Qa as wt,Qi as Tt,Qo as w,Qt as Et,Ra as Dt,Ri as Ot,Sa as kt,St as At,Ti as jt,To as Mt,Ts as Nt,Tt as Pt,Ua as T,Un as Ft,Va as It,Vt as Lt,W as E,Wn as Rt,Wr as zt,Xa as Bt,Xi as Vt,Xo as Ht,Ya as Ut,Yi as D,Yo as Wt,Yt as Gt,Z as Kt,Zi as qt,Zt as Jt,_n as Yt,_o as Xt,_r as Zt,_t as Qt,ai as $t,at as O,bo as en,bt as tn,d as nn,do as rn,dr as an,ds as on,ei as sn,en as cn,et as ln,fo as un,gi as dn,gn as fn,go as pn,gr as mn,gt as hn,hs as gn,ht as _n,io as vn,it as yn,ja as bn,ji as xn,jn as Sn,jt as Cn,ki as wn,kn as Tn,kr as En,kt as Dn,lr as On,lt as kn,mo as An,ms as k,na as jn,ni as Mn,no as Nn,ns as Pn,nt as Fn,o as In,p as Ln,po as Rn,ps as zn,q as Bn,qi as Vn,ra as Hn,ri as A,rr as Un,rt as Wn,so as Gn,t as Kn,ta as qn,ti as Jn,to as Yn,tt as Xn,u as Zn,un as Qn,vn as $n,vo as er,vr as tr,vs as j,vt as nr,wa as rr,wi as ir,wo as ar,ws as M,wt as or,x as sr,xt as cr,ya as lr,yn as ur,yo as dr,yt as fr,za as pr,zi as mr,zn as hr}from"./boards.js";var gr=()=>`${+(450/60).toFixed(1)} minutes`,N=e=>{let t=tt.get(e);if(!t)throw Error(`The help names a recipe there is not: ${e}`);return t},P=(e,t=!1)=>ae(N(e).inputs.map(e=>[e.item,e.count??1]),t),F=(e,t)=>{let n=N(e).inputs.find(e=>e.item===t);if(!n)throw Error(`The help says ${e} takes ${t}, and it does not.`);return n.count??1},I=e=>N(e).count??1,_r=e=>{let t=N(e);return`${(be.get(t.skill)?.name??t.skill).toLowerCase()} ${t.difficulty??0}`},L=e=>{let t=De.get(e);if(!t)throw Error(`The help names a material there is not: ${e}`);return t},R=e=>xe[e],z=e=>1-fe(R(e).roll,1),B=(e,t)=>g(e).feeds?.[t]??0,V=100,H=1,vr=3600,yr=e=>`${String(Math.floor(e)).padStart(2,`0`)}:${String(Math.round(e%1*60)).padStart(2,`0`)}`,br=Object.values(O).filter(e=>e.glow),xr=Object.values(O).filter(e=>e.wound===`burn`),Sr=18/24,U=e=>be.get(e)?.start??1,W=100,Cr=100,wr=k.plate.burden*L(`iron`).weight,Tr=e=>Math.round(100/(_t(e)*L(`copper`).wear)/10)*10,Er=80,Dr=90,Or=e=>Math.ceil(Er/Xe(e).healed),kr=e=>`${+(Er*Xe(e).cost).toFixed(1)} points`,Ar=Object.values(ke),jr=`${b} to ${+(b+or).toFixed(2)} times`,G=l.map((e,t)=>t).slice(1),Mr=Qe.get(`study_book`)?.baseTime??0,Nr=[...je].sort((e,t)=>e.difficulty-t.difficulty),Pr=[...new Set(zn.map(e=>e.slot))],Fr=Object.values(k).filter(e=>!zn.some(t=>t.cls===e.id&&tt.get(`make_${t.id}`)?.inputs.some(e=>e.item===`dragon_scale`))),Ir=[...new Set(j.map(e=>e.kind))],Lr=j.filter(e=>e.ammo&&tt.get(`make_${e.id}`)?.inputs.some(e=>e.item===`bow_string`)),Rr=Object.values(O).filter(e=>e.butcher?.feather||e.shearYield===`feather`),K=x[x.length-1],zr=e=>r.find(t=>t.id===e)?.level??0,Br=O.orse.speed*We(0),Vr=Math.min(5,O.orse.speed*We(W)),Hr=c(Object.entries(an).map(([e,t],n)=>`level ${e} ${n===0?`wants `:``}${c(t.map(e=>`${e.label[0].toLowerCase()}${e.label.slice(1)}`))}`)),Ur=[...new Set(Object.values(O).filter(e=>!e.monster).map(e=>e.workRange))].sort((e,t)=>e-t),Wr=(()=>{let e=new Map;for(let t of Object.values(O))t.rangePerStep&&t.rangePerStep!==10&&e.set(t.rangePerStep,[...e.get(t.rangePerStep)??[],`a ${t.name}`]);return c([...e.entries()].sort((e,t)=>e[0]-t[0]).map(([e,t])=>`${c(t).replace(/ and ([^,]*)$/,` or $1`)} ${e}`))})(),Gr=c([0,20,40,W].map((e,t)=>t===0?`${p(rr(e))} pass below ${p(20)}`:`${p(rr(e))} at ${p(e)}`)),Kr=e=>e&&`${e[0].toLowerCase()}${e.slice(1)}`,qr=Object.values(O).filter(e=>e.monster),Jr=qr.map(e=>e.notice??7).sort((e,t)=>e-t),Yr=y.reduce((e,[,t])=>e+t,0),Xr=ye.filter(e=>!Oe.some(t=>e===`${t}_lump`)),Zr=j.find(e=>e.id===`composite_bow`)??j[0],Qr=[...Lr].sort((e,t)=>(t.range??0)-(e.range??0))[0]??j[0],$r=zn.filter(e=>e.cls===`scale`).reduce((e,t)=>e+F(`make_${t.id}`,`dragon_scale`),0),ei=Object.fromEntries(D.map(e=>{let t=Vt.filter(t=>t.tier===e).map(e=>Math.max(...Object.values(e.effects).map(e=>Math.abs((e??1)-1))));return[e,[Math.min(...t),Math.max(...t)]]})),q=oe.filter(e=>e.level).sort((e,t)=>(e.level??0)-(t.level??0)),ti=e=>e.replace(/ (vein|seam)$/,``).toLowerCase(),ni=[1,50,90,99],ri=e=>Ce(e,At,1),ii=e=>String(Number(ri(e).toPrecision(ri(e)>=.1?2:1))),ai=()=>{let e=S(dn).bill.map(([e,t])=>`<b>${t} × ${g(e).name.toLowerCase()}</b>`);return`${e.slice(0,-1).join(`, `)} and ${e[e.length-1]}`},oi=Rn[An[0].class].length,si=pn/oi,ci=e=>An.find(t=>t.rank===e)?.cost??0,li=e=>ci(e)===1?`a point`:`${p(ci(e))} points`,ui=(e,t)=>An.find(n=>n.channel===e&&n.rank===t)?.note??``,di=un.filter(e=>Xt.has(e.id)),fi=di.length?C(di[0].id)[0]:void 0,pi=e=>C(`forester`).find(t=>t.name===e)?.fx??{},mi=2*(pi(`Clear Brush`).clear_brush??0)+1,hi=e=>C(`farmer`).find(t=>t.name===e)?.fx??{},gi=e=>C(`cook`).find(t=>t.name===e)?.fx??{},_i=e=>C(`tailor`).find(t=>t.name===e)?.fx??{},vi=2*(hi(`Sow a Patch`).sow_patch??0)+1,yi=[...new Set(dr.map(e=>Object.keys(e.muls).length))].sort((e,t)=>e-t),bi=e=>Object.entries(ar(e)?.muls??{}).map(([e,t])=>`${rn[e].note.toLowerCase()} ${en(t)}`).join(`, `),J=be.get(`awareness`)?.start??20,xi=Object.keys(e).filter(t=>e[t].holds),Si=Mt.filter(e=>tt.get(`make_${e.id}`)?.skill===`fine_carpentry`),Ci=Si.filter(e=>e.capacity&&!e.liquid).sort((e,t)=>(e.capacity??0)-(t.capacity??0)),wi=Object.keys(se).length,Ti=Mt.filter(e=>e.boat),Ei=S(`rowing_boat`),Y=S(`sailing_boat`),X=S(`caravel`),Di=S(`large_cart`),Z=S(`wagon`),Oi=Mt.filter(e=>e.liquid).sort((e,t)=>(e.liquid??0)-(t.liquid??0)),ki=S(`craft_bin`).heft??0,Ai=S(`seed_bin`).heft??0,ji=S(`sprout_bin`).heft??0,Mi=11,Ni=(sr.Gold??0)/(sr.Silver??1),Pi=5,Fi=[...o].filter(e=>!Oe.includes(e)),Ii=40,Q=70,Li=pt.get(`cider`)??rt[0],Ri=_e.filter(e=>e.fruit),zi=pr.flatMap(e=>[T(e,1),T(e,V)]),Bi=Math.min(...zi),Vi=Math.max(...zi),Hi=e=>{let t=ve.find(t=>t.id===e);if(!t)throw Error(`The help names a mould there is not: ${e}`);return`poured at the smelter and beaten out on an anvil, ${t.lumps===1?`a lump of metal`:`${p(t.lumps)} lumps of metal`} ${t.per?`to ${p(t.per)}`:`to each`}`},Ui=e=>{let t=e=>e.speed*fe(e.roll,1);return 60*t(R(_.Slabs))/t(R(e))},$={ql:50,force:.6},Wi=c([Math.PI/2,Math.PI,yt,0].map(e=>(Y.boat?Dn(Y.boat,$.ql,20,Lt($.force)*St(e),0):0).toFixed(1))),Gi=()=>{let e=Object.values(qt).map(e=>`<b>${e.label}</b> (${e.means})`);return`${e.slice(0,-1).join(`, `)} or ${e[e.length-1]}`};function Ki(){let e=ai(),o=Gi();return`
    <h3>Getting around</h3>
    <p><b>You walk by clicking.</b> Nothing on the keyboard moves you: the keys move the
    <i>view</i>, which is a different thing and used far more often. Click where you want to be
    and you will set off, going round whatever is in the way.</p>
    <table>
      <tr><td><kbd>Left click</kbd></td><td>Walk to a tile — the only thing that moves you</td></tr>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></td><td>Push the view about (detaches the camera)</td></tr>
      <tr><td><kbd>Drag</kbd></td><td>The same, with the mouse</td></tr>
      <tr><td><kbd>Scroll</kbd> / <kbd>+</kbd> <kbd>-</kbd></td><td>Zoom</td></tr>
      <tr><td><kbd>C</kbd></td><td>Centre the camera on yourself, and have it follow again</td></tr>
      <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>Turn the view ${t(1/8)} of a turn; the compass shows north</td></tr>
    </table>
    <p>Every key here can be changed: <b>Settings</b> (<kbd>O</kbd>) has a <b>Keys</b> tab with the
    whole list in it. Click a key, press the one you would rather have, and it is set — a key that
    was already doing something else is taken off it rather than doing both. The number keys
    <kbd>1</kbd>–<kbd>0</kbd> are the exception and cannot be moved: they always answer to whatever
    the Tile window or the toolbelt is offering.</p>
    <h3>Touch screens</h3>
    <table>
      <tr><td>Tap</td><td>Walk to a tile</td></tr>
      <tr><td>Drag</td><td>Look around</td></tr>
      <tr><td>Pinch</td><td>Zoom</td></tr>
      <tr><td>Long press</td><td>Actions for a tile or tree</td></tr>
    </table>
    <h3>Doing things</h3>
    <table>
      <tr><td><kbd>Right click</kbd></td><td>Actions for a tile or tree</td></tr>
      <tr><td><kbd>Click</kbd> an item</td><td>Its actions: eat, drink, drop, examine…</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Stop the current action and forget what is lined up</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Talk in the event window</td></tr>
    </table>
    <h3>The event log, and finding things in it</h3>
    <p>The log is cut into tabs: <b>All</b>, <b>Work</b> (what your hands have been doing),
    <b>Combat</b> (every blow given and taken, what has your scent, and what went down),
    <b>Skills</b> (what you have learned), <b>Talk</b> and <b>Trouble</b> (what went wrong, and why).
    A tab with lines waiting on it says how many, and opening it clears the count. The box beside the
    tabs searches whatever tab you are on, and <kbd>Esc</kbd> in it clears the search.</p>
    <h3>Marks on the map, and the way home</h3>
    <p>An island is a great many tiles and the good clay is on one of them. <b>Right-click the map</b>
    (<kbd>M</kbd>), or press <b>Mark here</b>, to pin a name to a spot; the tile's own menu offers the
    same with a colour chosen up front. Marks are drawn as pins with their names beside them, listed
    under the map nearest first, and each has a <b>Go</b> button that walks you to it. Click a pin's
    dot in the list to cycle its colour, click its name to rename it, and × rubs it off. The map holds
    ${p(64)} of them; past that the oldest is pushed off.</p>
    <p><kbd>Home</kbd>, or the <b>Walk home</b> button on the map, sets off for your settlement token
    &mdash; or, before you have founded anything, for the shore you came in on or the last bed you
    woke in.</p>
    <h3>The camera</h3>
    <p>The view keeps to you by default; dragging it away lets it go, and <kbd>C</kbd> or the
    <b>Centre</b> button takes it back. Resting the cursor against the <b>edge of the screen</b>
    slides the view that way, harder the closer to the edge, which is a way of looking about without
    holding the mouse down &mdash; and, like dragging, it lets the camera go until you call it back.
    Neither happens while the cursor is over a window or the toolbar. Both can be turned off in
    Settings (<kbd>O</kbd>) if you would rather only drag.</p>
    <h3>Your wildermon, in order</h3>
    <p>The Wildermon window (<kbd>P</kbd>) has a search box and an order: by name, level, kind,
    health, hunger, care, age, or the best trait each one carries. The search matches a name, a kind,
    a job, an age, an orders setting or any trait, so "supreme" finds everything worth breeding from
    and "hungry" is answered by the footer, which counts the herd and says how many are hungry or
    hurt. Grouped lists them by where they are; Flat runs the whole herd together.</p>
    <p>Any one of them that wants something says so on its own card: a <b>hurt</b> tag on anything
    under ${v(nn)} of the health it can carry, a <b>hungry</b> one on anything under ${v(Zn)} fed, and the card
    itself outlined so it is found by scrolling rather than by reading. The counts in the footer are
    buttons &mdash; click one and the herd is laid out flat, worst first, with nothing filtered out,
    so a count of what is wrong takes you to it.</p>
    <h3>Other people</h3>
    <p>Right-click somebody standing on the island and you can <b>invite them to your settlement</b>,
    <b>ask them to be a friend</b>, or <b>write to them</b>. All of them live in the <b>Social</b> window
    (<kbd>Y</kbd>) as well, under its tabs: <b>Waiting</b> is everything that wants a yes or a no
    from you, <b>Friends</b> is everybody you know and where they are, and <b>Letters</b> is what has
    been written.</p>
    <p>A <b>citizen</b> of a settlement may build on its land, use its crates and stores, and draw from
    its water, exactly as the founder does. Disbanding, upgrading, renaming and setting wildermon to
    work stay with whoever planted the stake.</p>
    <p>You may found <b>one</b> settlement of your own and be a citizen of <b>${p(3)}</b> others, whether
    or not you hold one. A border you may work inside is drawn at the same weight as your own, so land
    you were asked onto does not look like a stranger's. Leaving a roll frees the place at once, and an
    invitation you had no room for is left standing until you do.</p>
    <p>To <b>leave</b> a settlement you were asked onto, right-click its land and choose <b>Leave</b> under
    its name, or use the button in the Settlement window or the People window. You come off its roll at
    once and are a stranger there: you may walk it and shape nothing, and of the stores on it only the ones
    you made yourself still open for you. Its founder is told, and only a new invitation puts you back.</p>
    <p>A <b>friend</b> is mutual: you ask, they say yes, and after that each of you can see where the
    other is &mdash; but only while they are actually at the keyboard. A friend who has gone shows as
    away and nothing more. <b>Letters</b> are kept: one reaches an open tab the moment it is written and
    is still waiting the next time somebody looks, however long that takes.</p>
    <p><b>While you were away.</b> Once your browser has said nothing to the island for
    ${gr()}, the island counts you as gone, and from then until you come back it keeps count for
    you: every load your workers put into the stores, by item; every young one born to your wildermon,
    and any that went off into the wild because something already followed you and there was no empty
    creature crate for it; everything your stalls sold and the silver it went for; everything brought
    to your buy orders and the silver it cost; and every parcel posted to you, by who sent it. When you
    come back a window lists all of it, and the same lines go into the event log.</p>
    <h3>Leaderboards</h3>
    <p>The <b>Leaderboards</b> window (<kbd>F2</kbd>) ranks everybody on an island, and asks the island again
    every 30 seconds while it is open. <b>Skills:</b> ${Kn.skills}
    <b>Wildermon:</b> ${Kn.wildermon} <b>Settlements:</b> ${Kn.settlements}
    In a game of your own there is nobody to rank against, so it shows your best skill (characteristics not
    counted), your best-bred wildermon and your settlement instead, each measured the way its board measures.</p>

    <h3>The settlement window</h3>
    <p><kbd>N</kbd> opens the settlement at a glance: its level and how far the border runs, how many
    wildermon are working of how many it can take, what the next upgrade still wants and the button
    that buys it, everything standing inside the border, and the standing orders for everything kept
    there. Each thing listed has a button that walks you to it.</p>
    <h3>What a tool is worth</h3>
    <p>A tool is rarely worth the number stamped on it. Damage drags it down, the metal of its head
    lifts or lowers it, and rarity and a blessing lift it further &mdash; and it is that figure, not
    the quality it was made at, that decides how fast a job goes, how often it comes out right, and
    how good what comes out of it is. The pack shows both when they differ, the quality and then
    <b>&rarr;</b> what it is worth, and examining a thing says it in words.</p>
    <h3>The number keys</h3>
    <p>The number keys mean different things depending on what is in front of you. With something
    <b>selected</b> in the Tile window (<kbd>T</kbd>) &mdash; a tile, a tree, a wildermon, a crate
    &mdash; <kbd>1</kbd> to <kbd>9</kbd> and <kbd>0</kbd> do the <b>first ${p(Ln.length)} things that can actually
    be done to it</b>, in the order the window lists them, and each row shows its key. A row that only
    opens onto more choices takes no key, and neither does one that is greyed out with a reason, so a
    number never does nothing. With <b>nothing selected</b>, or the window shut, the same keys press
    the loops on your belt; the belt bar dims while the window has them.</p>
    <h3>What a wildermon's tooltip tells you</h3>
    <p>Pointing at a creature says what is actually worth knowing about it rather than a line of
    colour. A <b>wild</b> one gives its kind and age, what it will take from your hand, the taming it
    asks against the taming you have, and <b>the real odds of one offering</b> &mdash; the same number
    the attempt itself rolls against, hunger, soul, age, path and a run of offerings all counted. One
    of <b>your own</b> gives its name, sex, kind, age and level; its health and how full it is, with a
    bar for each; how well it has been brushed; what it is doing and how good it is at it, with a
    worker's reach in tiles; the traits it carries, marked when they are better than common and left
    as <i>something unread</i> until your animal husbandry is high enough to read them; and how long a
    carried young has left. A <b>monster</b> gives its health and what it hits for, and says plainly
    that it cannot be tamed.</p>
    <h3>The belt, and doing a thing many times</h3>
    <p>A job that runs on and on &mdash; digging, mining, chopping, making bricks &mdash; is offered by
    the handful as well as one at a time: <b>once</b>, ${In.map(p).join(`, `)}, or <b>until you
    stop</b>. Pick a number and it counts itself down and puts the work away when it is done, and the
    action bar says how far through it is, so a run of bricks is one right-click rather than one
    each.</p>
    <p>Stitch a <b>toolbelt</b> (${P(`make_toolbelt`)}, on an awl) and wear it, and it carries the
    jobs you do most. It has <b>one loop for every ${p(10)} points</b> of how well it was made, to a full ${p(10)}
    loops on a perfect one, and every loop answers to a number key &mdash; <kbd>1</kbd> to <kbd>9</kbd>,
    and <kbd>0</kbd> for the tenth. Hang a job on a loop from any menu, by the entry
    <i>Hang a job on your belt</i>. A job hung from your pack remembers the <b>kind</b> of thing rather
    than the one in your hand, so the loop still works on the next loaf you bake; a job hung from the
    ground is done <b>wherever you are pointing</b>, and on the tile under your own feet when you are
    pointing at nothing. Right-click a loop to take the job off it again. Take the belt off and the
    loops go with it, but nothing on them is forgotten.</p>
    <p>Ask for a second job while the first is still going and it <b>lines up behind it</b> rather than
    pushing it aside: it starts the moment the one in hand is done, walking you over if it needs to. The
    bar above the action shows what is waiting. You can keep <b>${p(3)}</b> jobs in your head to begin
    with, and one more for every ${p(10)} points of <b>mind logic</b>, which is earned by crafting. Walking
    off, stopping with <kbd>Esc</kbd> or clicking somewhere else forgets the lot.</p>
    <h3>What the characteristics are for</h3>
    <p><b>Work, and only work.</b> Eating, drinking, and carrying things in and out of crates, bags and
    barrels teach the body nothing: they cost what wind they cost and leave every characteristic where
    it was. Swinging, building, digging and hauling are what the body learns from.</p>
    <p>The characteristics start at 20 and rise slowly from the work that uses them, and each one
    does something plain:</p>
    <table>
      <tr><td><b>Body strength</b></td><td>How hard you hit. Earned by fighting.</td></tr>
      <tr><td><b>Body stamina</b></td><td>Less wind spent per action and quicker to get it back. Earned by spending it.</td></tr>
      <tr><td><b>Body control</b></td><td>Everything takes less time. Earned by doing any <i>work</i> at all.</td></tr>
      <tr><td><b>Mind logic</b></td><td>Jobs you can line up, and difficult crafts come out right more often. Earned by crafting.</td></tr>
      <tr><td><b>Soul strength</b></td><td>A wild animal is readier to trust you. Earned by taming, success or not.</td></tr>
    </table>
    <p><b>Climbing</b> raises the step you can take between tiles from 32 and the slope of a tile
    you can stand on from 60, both by ${ur} a level &mdash; ground that turns you back
    at the start is walkable once you have worked at it. It is earned on your own feet, by every step
    between tiles more than ${t($n)} of 32 up or down, and more for a steeper
    one: not in a saddle, on a cart or a boat, on a bridge or on an upper floor.
    <b>Swimming</b> makes deep water less of a wade and costs less wind, and is earned by being out of
    your depth. Neither announces every scrap it picks up; both say so as they pass each whole point,
    and the Skills window (<kbd>K</kbd>) shows what each one is worth right now.</p>
    <h3>What you can see</h3>
    <p>The island starts unknown and is uncovered by walking it. Ground comes in the states below, and
    the map shows each of them differently.</p>
    <table>
      <tr><td><b>Unknown</b></td><td>Never laid eyes on. <b>Black</b>: no ground, no trees, nothing
      drawn at all, and it cannot be clicked or acted on. Not a dark patch of map &mdash; a hole in
      it.</td></tr>
      <tr><td><b>In sight</b></td><td>Somebody is looking at it now. Drawn as it is, in full colour,
      with everything standing on it.</td></tr>
      <tr><td><b>Remembered</b></td><td>Walked, but not watched. Drawn in <b>grey</b>, without detail,
      and <b>as it was when you last saw it</b> &mdash; fell a wood, walk away, and the map keeps the
      trees until you go back and look. Colour is what an eye is getting now; a memory of a place is
      its shape and nothing else.</td></tr>
    </table>
    <p>What you have seen is the map. The circle you can see from where you stand is what turns black
    into grey, so the shape of the island is the shape of everywhere you have been.</p>
    <h4>Awareness, and how far that circle reaches</h4>
    <p><b>Awareness</b> is a characteristic like body strength, and it is the whole of how far you
    see. Everybody washes ashore with a body and a mind half grown and nobody washes ashore able to
    read a dark hillside, so it <b>starts at ${J}</b> where the others start at 20 &mdash; and the
    ${p(15)} tiles on the flat that this island used to give everybody is what it gives somebody at the
    top of it. At ${J} you see ${v(cn(J))} of that &mdash; ${p(Math.round(15*cn(J)))}
    tiles on the flat against ${p(15)}. What it is worth goes as the square root of the level, so the
    early levels are worth the most, and a few tiles more is the difference between being walked into
    and seeing it coming.</p>
    <p>It is learned in exactly one place: <b>fighting in the dark</b>. Nothing else on this island
    teaches it at all. Nothing teaches a person what they were not noticing like something coming out
    of the night at them &mdash; and it is weighted by how dark it actually is, so a scuffle at dusk is
    worth a fraction of one at the dead of night. Taking a blow teaches more than landing one.</p>
    <p>On top of that: <b>height is worth real distance</b>, a ridge hides the hollow behind it, a wood
    is ${p(Math.ceil(1/Ie))} trees deep to the eye, and the <b>dark takes ${t(Et)} of everything</b>. Your
    settlement is watched while you hold it, and your own wildermon are eyes of their own wherever they
    are working.</p>
    <p>Of a building's walls, only a <b>solid</b> one stops the eye. A window, a bay, a door, a double
    door, an arch and a gate are seen through, and a fence or a half wall is seen over, as far as you
    can see anywhere else &mdash; from a doorway you see the wedge of the room beyond it, and from inside
    a room all of it.</p>
    <p>All of that is in Settings under <b>Fog of war</b>, if you would rather see the whole island at
    once.</p>
    <p>The wildlife works the same way. An island holds so much of it, but only the stretch of country
    you are walking has it in the flesh: a creature left a long way behind is <b>put back on the books</b>
    for the country it was in, and comes out again when somebody walks that way. Nothing is ever seen to
    come or go &mdash; it happens well past the edge of anybody's sight &mdash; and the island keeps the same
    head of wildlife however far you wander. It is what lets the map grow without the game slowing down.</p>
    <h3>Windows</h3>
    <table>
      <tr><td><kbd>I</kbd></td><td>Inventory</td></tr>
      <tr><td><kbd>R</kbd></td><td>Crafting: everything you can make with what you carry</td></tr>
      <tr><td><kbd>T</kbd></td><td>Tile: everything you can do to the tile you last clicked</td></tr>
      <tr><td><kbd>Page Up</kbd> / <kbd>Page Down</kbd></td><td>Look at the storey above or below</td></tr>
      <tr><td><kbd>X</kbd></td><td>Cut away the walls facing you</td></tr>
      <tr><td><kbd>K</kbd></td><td>Skills</td></tr>
      <tr><td><kbd>F</kbd></td><td>Trades: what every trade offers, the one you took up, its tree or its perks, and its rite</td></tr>
      <tr><td><kbd>L</kbd></td><td>Event log</td></tr>
      <tr><td><kbd>M</kbd></td><td>Map</td></tr>
      <tr><td><kbd>G</kbd></td><td>Toggle the tile grid</td></tr>
      <tr><td><kbd>P</kbd></td><td>Wildermon: your tamed creatures' stats and actions</td></tr>
      <tr><td><kbd>J</kbd></td><td>Journal: everything worth doing, ticking itself off</td></tr>
      <tr><td><kbd>B</kbd></td><td>Ledger: everything you have ever made</td></tr>
      <tr><td><kbd>N</kbd></td><td>Settlement: your deed at a glance</td></tr>
      <tr><td><kbd>Y</kbd></td><td>Social: who is waiting on you, who you know, and what has been written</td></tr>
      <tr><td><kbd>O</kbd></td><td>Settings: what the island looks like, what every key does, and how you look</td></tr>
      <tr><td><kbd>F1</kbd></td><td>This help</td></tr>
      <tr><td>⤢ / double-click title</td><td>Expand a window to nearly the whole screen, and back</td></tr>
    </table>
    <h3>Trades</h3>
    <p>A trade is the thing you are, on top of the things you know. Take one to <b>50</b> in any skill it
    covers and it opens; you may hold <b>one craft trade and one fighting trade</b> at once, and the
    <b>Trades</b> window (<kbd>F</kbd>) is where you take them up and spend what they earn.</p>
    <p>A trade on a <b>tree</b> earns <b>points</b> off the best skill it covers, and its tree is <b>${p(oi)} columns of
    ${p(si)}</b>. A column is one <b>channel</b>: one number in the rules, and every card names it and says
    exactly what that node does to it &mdash; ${[`hands`,`aim`,`knit`].map((e,t)=>`<i>${ui(e,[1,1,si][t])}</i>`).join(`, `)}.
    The lower nodes cost ${li(1)} each, the one above them costs ${p(ci(si))}, and the lower must be
    bought first. A few channels are better lower &mdash; ${c(Object.values(rn).filter(e=>e.lower).map(e=>e.note.toLowerCase()))}
    &mdash; and the sign on the card is the change to the number, so those read as a minus.</p>
    ${fi?`<p>A trade on <b>perks</b> &mdash; ${c(di.map(e=>`the ${e.name}`))} &mdash; has no tree and no points.
    It has <b>${p(er.length)} tiers of ${p(3)}</b>: the first opens with the trade and the others
    at ${c(er.slice(1).map(String))} in its main skill, and at each tier you take <b>one</b> of the
    ${p(3)}. Every card says exactly what that perk changes and by how much &mdash;
    ${fi.name}: <i>${fi.note}</i> A perk taken is kept for as long as the trade is.</p>`:``}
    <p>A <b>rite</b> is the one thing a trade may ask for out loud: ${c(yi.map(p)).replace(` and `,` or `)} channels pushed much
    harder for a fixed number of seconds, paid out of the same <b>favour</b> a prayer is paid from, and
    then a rest before you may ask again. The card gives each of those figures. Some trade one channel away
    for another &mdash; ${ar(`redhour`)?.name} is <i>${bi(`redhour`)}</i> &mdash; so read both halves before you call one.
    Only the <b>fighting</b> trades have a rite; a craft trade has its nodes or its perks and none. It sits at
    the head of its trade's tree, with the reason underneath when you cannot call it.</p>
    <p>Every card has <b>What it offers</b>, which lays the trade open before you take it up: its
    ${p(er.length)} tiers of perks with the skill each opens at and what you have, or its rite and its
    ${p(oi)} columns with what each node costs and does. That is read from the rulebook, and it is there playing by
    yourself too. <b>Take up</b> and <b>Take this one</b> each ask a second time before anything is done, saying what
    goes with it, what it costs and which perks close.</p>
    <p>Everything else on that window is the <b>island's</b> answer rather than this browser's guess &mdash;
    what you have spent, what is in your purse, whether the altar will hear you &mdash; so when a button
    will not press, the sentence under it is the island's own, and it is the truth.</p>
    <p>Putting a trade down for another costs <b>500 silver</b>, and the nodes you bought or the perks you
    took for the old one go with it. The other slot keeps what it had.</p>
    <p>A <b>Bauble of Regret</b> undoes a trade instead. ${f(v(vn))} of what a trowel turns up is one,
    whole. With one in your pack, the card of a trade you hold has <i>Undo</i>: it breaks the bauble and puts
    that trade down with the nodes you bought or the perks you took for it, leaving its slot empty, so the next trade you take up in
    that slot costs nothing. The other slot keeps what it had.</p>
    <p>Drag a window by its title bar and resize it from the bottom-right corner. The layout is remembered.</p>
    <p><b>How you look</b> can be changed at any time: <i>Change…</i> under <b>How you look</b> in
    Settings (<kbd>O</kbd>) opens the creator from the account page on the look you have on. Nothing
    changes until you press <i>Wear this look</i>. On an island the look is kept with your account and
    goes on your body on every island you have one on; playing on your own, it is saved with the game.</p>
    <p>The <b>map</b> (<kbd>M</kbd>) shows the same states: dark where you have not been, dim
    where you have, and bright where somebody is looking now. An island is far bigger than the window, so
    the map does not try to show all of it at once: it looks at the ground you have walked and widens as
    you explore, out to the whole island once you have been round it. Click it to send the view there.</p>
    <p>Clicking a tile <b>chooses</b> it: it is outlined in the world and the <b>Tile</b> window fills
    with everything you could do to it &mdash; the same list the right-click menu shows, because it is
    built from the same list. Anything with a reason it cannot be done yet is greyed out with the reason
    beside it, and a row with a <b>&#9656;</b> opens in place. It works on whatever you clicked, not just
    bare ground: a chest, a smelter, a campfire, a wildermon. The game can be played from it with one
    button, which is what it is for. If you would rather keep to the right-click menu, untick
    <i>Open the tile window on a click</i> in Settings and it will stay where you put it.</p>
    <p>The little <b>i</b> beside the title answers the other question: not what you can do to a thing
    this moment but what it is <i>for</i>. On ground it gives the pace it is walked at, what a loaded
    cart makes of it, what a shovel or a pickaxe gets out of it, whether anything grows on it and
    whether it will take paving. On a wildermon it lists every skill the animal has and what each one
    decides. Hover it to read it, click it to pin it open.</p>
    <p><b>Trees are picked by their ground, not their canopy.</b> A mature tree is drawn leaning over
    the tiles behind it; the tile it stands on is the one that answers to a click or a hover, so the
    cursor never latches onto a tree it is nowhere near.</p>
    <p>The <b>inventory</b> and the <b>crafting</b> window each have a <b>search box</b> at the top.
    The inventory searches what you are carrying by name and kind; the recipe book searches on
    everything in a row at once &mdash; what it makes, the trade it takes, where it has to be worked and
    what goes into it &mdash; so <i>leather</i> finds every leather thing, <i>mason</i> finds the oven
    and the well, and <i>nail</i> finds all ${p(zt.filter(e=>e.inputs.some(e=>e.item===`nail`)).length)} recipes that want nails. The count at the foot
    tells you how many matched. <kbd>Esc</kbd> in the box clears it.</p>
    <h3>The ledger</h3>
    <p>Everything that has ever come off your bench, your anvil or your oven is written down in the
    Ledger (<kbd>B</kbd>): every kind of thing, how many of them, how many came off <b>rare</b> or
    better, and <b>the best one you ever managed</b>. It can be put in order by any of those, or by
    name, or newest first, and searched. The first of anything says so in the log, and so does every
    time you beat your own best at something.</p>
    <p>The journal says what there is to do. This says what you have done, which is the number a maker
    actually keeps.</p>
    <h3>The journal</h3>
    <p>There is a great deal to do on this island and nothing anywhere that says so. The <b>journal</b>
    (<kbd>J</kbd>) is that list: ${p(Ue.length)} goals in ${p(ir.length)} chapters, from felling your first tree to
    taking a trade to ${jt}. Nothing is required and nothing is rewarded &mdash; a goal is only something
    somebody thought worth doing. Each ticks itself off the moment you have done it, says so in the
    events, and stays ticked for good afterwards whatever becomes of the thing that did it.</p>
    <h3>Crafting</h3>
    <p>The crafting window (<kbd>R</kbd>) is your recipe book, grouped by craft: a carving knife and a
    log give shafts or a mallet, a shaft becomes a deed stake, a saw gives planks and timbers, a chisel
    turns shards into bricks, and so on. Each recipe lists its tool and materials, green when you have
    them at hand and red when you do not, and whatever you can make right now sits at the top of its group. Tick
    <i>Only what I can make</i> to hide the rest. The same recipes are on each material's own menu,
    where <i>All</i> keeps going until the materials run out.</p>
    <p><b>What is at hand.</b> A craft, and any work at a station that uses something up, takes it from
    your pack, then the bags on your back, then your stores within <b>3 tiles</b> of where you
    stand, nearest first. At a station that means the metal for a mould or an anvil, ore and scrap for
    a smelter, unfired clay for a kiln, fuel for a campfire, smelter, kiln or oven, a casting or coin
    metal at an anvil, the stock worked into a thing to improve it, and what goes into a brew. A stack in
    a store is marked with the store's name on the station's menu. Tools still have to be carried:
    the moulds, the coin die, files and the rest. Nothing is taken from a store behind a padlock you
    hold no key to, from one somebody else set down off your settlement, from a trash crate or a market
    stall, and nothing put by is ever used. A cart, a wagon or a boat is anybody's store, whoever built
    it.</p>
    <p>The settings under <b>Crafting</b> in Settings (<kbd>O</kbd>) narrow that.
    <i>Use stores within reach</i>, unticked, keeps it to your pack and the bags on your back.
    <i>Keep rare materials out of crafting</i> stops a craft or a station picking a
    ${l.slice(1,-1).map(e=>e.name).join(`, `)} or ${l[l.length-1].name} stack by itself; one you point it at is still
    used &mdash; the stack you right-click to make something, or one you choose off a station's menu.
    On an island the island keeps both with your body, and a job it finishes later goes by them.</p>
    <h3>What a thing is made of</h3>
    <p>The same bill of materials in a different wood, or a different metal, makes a different
    thing. A log keeps the wood it was cut from all the way through &mdash; planks, timbers, shafts and
    whatever you nail together out of them &mdash; and a lump keeps its metal from the seam to the
    finished blade. Every wood and every metal carries the same numbers: how hard it is to work,
    what it weighs, how much punishment it takes, how fast it rots, what it is worth as an edge, as
    armour, as a tool, and as a box to put things in. The examine line on any item says what it is made
    of and what that lends it.</p>
    <p><b>One craft, one material.</b> You cannot nail an oak plank to a pine one and call it a chest.
    The crafting window shows what the piece would come out <i>of</i>, and picks whichever you have most
    of; carry more than one kind and the row offers a choice of them, and clicking a stack in your pack
    uses that one instead. Nails and the like are exempt
    &mdash; they are whatever metal they are. <b>Improving</b> is the same rule: an oak chest wants more
    oak, and a bronze blade will not take copper.</p>
    <p><b>The ${p(_e.filter(e=>!e.fruit).length)} woods that bear nothing.</b> <b>Pine</b> is soft, light and quick to work, and rots as fast as it grew.
    <b>Willow</b> and <b>birch</b> are light and springy. <b>Maple</b> is even-tempered. <b>Oak</b> is
    hard going and worth it: an oak thing takes ${v(L(`oak`).wear/L(`pine`).wear)} of the knocks a pine one does, holds more
    and swings harder, at the price of weight. <b>Cedar</b> barely rots at all &mdash; whatever you mean
    to leave standing in the rain, build it of cedar. A <b>bow</b> is the fussiest thing on the island:
    a short bow is tillered from <b>willow</b>, a medium bow from <b>birch</b> and a long bow from
    <b>oak</b>, and nothing else will do.</p>
    <p><b>The ${p(r.length)} metals.</b> <b>Copper</b> is what everything starts in and is soft with it.
    <b>Tin</b>, <b>zinc</b>, <b>lead</b> and <b>pewter</b> are stock for alloys and nothing you would
    want to swing. <b>Iron</b> is the working metal of the island: harder than copper at everything,
    and the one thing it asks in return is that you do not leave it out in the rain. <b>Steel</b>,
    which is iron with coal beaten through it, keeps an edge ${s(L(`copper`).wear/L(`steel`).wear)} as long as copper and does not
    mind the weather. <b>Bronze</b> and <b>brass</b> are the first alloys worth a crucible. <b>Silver</b> hardly
    tarnishes and bites anything that carries its own light ${s(gn)} as hard, which is what a
    <b>Lume</b> or an <b>Embra</b> is. <b>Gold</b> rots at ${v(L(`gold`).decay/L(`copper`).decay)} of copper's pace, weighs
    ${s(L(`gold`).weight/L(`copper`).weight)} what copper does and is good for nothing else. The ${p(Fi.length)} out of the deep seams are what a
    lifetime of mining is for: <b>adamantine</b> takes the keenest edge, <b>glimmersteel</b> is light and turns
    aside ${v(L(`glimmersteel`).soak/L(`copper`).soak-1)} more than copper does, <b>mithril</b> is lighter than the wood it is hafted to, and
    <b>seryll</b> scarcely takes a mark at all. A tool's metal decides how fast and how true it works, so a
    bronze hatchet at ${Ii} works as well as a copper one at ${Math.round(Ii*L(`bronze`).bite/L(`copper`).bite)}; a weapon's metal decides
    what it does; armour's metal decides both what it stops and what it costs you to carry.</p>
    <h3>Brewing</h3>
    <p>Fill a barrel from a well or the shore, stand at it and <b>set a brew going</b>. ${u(rt.length)} of them:
    ${c(rt.map(e=>`<b>${e.name.toLowerCase()}</b> from ${h(e.input,e.count,!0)} and ${e.litres} litres of water in ${m(e.time)}`))}.
    Each gives back as many litres of drink as it took of water.</p>
    <p>A <b>quern</b> presses fruit too: ${p(F(`press_apple_juice`,`apple`))} of any fruit into a <b>bucket of juice</b>, sweet and with
    nothing dangerous in it, and ${p(F(`press_apple_cider`,`apple`))} apples or pears straight into a <b>bucket of cider</b> with no
    barrel and no waiting &mdash; one bucket, where the barrel would have made ${p(Li.litres/5)} from ${h(Li.input,Li.count)}
    and ${p(Li.litres)} litres of water.</p>
    <p>While it is working the barrel says so and nothing can be drawn off it &mdash; and nothing hurries
    it. When it stops, draw it into a bucket like any other liquid and drink from that. The quality of
    what comes out is half what went in and half your <b>brewing</b>, and a brew that will not take
    sours the whole barrel.</p>
    <p>What brewing is <i>for</i> is the knack. Anything drunk leaves one the way a cooked dish does,
    and a brew carries it far longer than food &mdash; at quality ${Q}, a baked potato's lasts
    ${m(T(`baked_potato`,Q))} and a bucket of wine's ${m(T(`wine_bucket`,Q))}. A barrel of the right thing
    before a long afternoon at the anvil is the single best use of an orchard.</p>
    <p>A Cook can learn to <b>distil</b>: ${P(`distil_wine`)} boiled off over a campfire into a <b>bucket of spirit</b>,
    and ${p(N(`distil_wine`).returns?.[0]?.[1]??0)} of the buckets back. At quality ${Q} a drink of spirit gives a knack of
    ${m(T(`spirit_bucket`,Q))}. A Cook with Strong Brew marks every barrel they set going: a drink from it, or from a
    bucket drawn off it, gives a knack ${v((gi(`Strong Brew`)[`brewed:wine`]??1)-1)} longer, whoever drinks it. Brew poured together is only as
    strong as the weakest of it, and a barrel emptied forgets it. A Cook can learn to boil <b>broth</b> too: ${P(`make_broth`)}
    over a campfire make ${p(I(`make_broth`))} bowls, each feeding a little of all ${p(Rt.length)}.</p>
    <h3>Fishing</h3>
    <p>Splice a <b>fishing rod</b> from ${P(`make_fishing_rod`)}, the ribbon bent into a hook, stand at
    water and fish. The line reaches ${p(3)} tiles, and it goes into whatever water within a cast is
    deepest &mdash; so where you stand is the whole trade. Standing inland catches nothing at all.</p>
    <p>${u(jn.length)} fish run at ${p(new Set(jn.map(e=>e.depth)).size)} depths, and each wants a hand to match:
    ${c(jn.map(e=>`<b>${e.name.toLowerCase()}</b> ${e.depth>0?`from ${p(e.depth)} deep`:`anywhere there is water`}${e.level>jn[0].level?` with fishing ${e.level}`:``}`))}.
    A gently shelving beach will never give you more than perch however good you get; a
    sheer bank with deep water right off the edge will give you everything. Each goes over a fire, and
    what comes off it follows the size of the fish &mdash; a pike is ${p(I(`cook_pike`))} helpings and a sturgeon
    ${p(I(`cook_sturgeon`))}.</p>
    <p><b>Bait</b> decides what bites. A bare hook catches whatever is passing, which mostly means
    minnows. Put something on it and you are fishing for a particular thing, and it is a ladder every
    rung of which is something you caught on the rung below: <b>worms</b> (turned out of damp dirt with
    a shovel &mdash; a marsh is full of them) bring up <b>perch</b>; a live <b>minnow</b> or raw
    <b>meat</b> brings up a <b>pike</b>; a whole <b>perch</b> on the hook is what brings a
    <b>sturgeon</b> up. Corn does at a pinch, and a Cook with Bait Maker cuts <b>offal</b> from every carcass, which
    ${c((qn.get(`offal`)?.favours??[]).map(e=>`${g(e).name.toLowerCase()}`))} come to. Anything worth using is taken out of your pack and put on
    the hook by itself, and the menu says which. In water deep enough for everything, with the hand for
    all of it, a sturgeon is ${v(Hn(`sturgeon`))} of what takes a bare hook and ${v(Hn(`sturgeon`,`perch`))} of what
    takes a perch.</p>
    <p>A net and a creel fish without a rod. A <b>net</b> &mdash; ${P(`make_net`)}, knotted with a
    needle &mdash; is <b>dragged</b> through water you can wade to: it takes several small fish at a
    haul and lets the big ones through, so it is how you feed a settlement rather than how you land a
    sturgeon. A <b>creel</b> &mdash; ${P(`make_creel`)} &mdash; is a basket with the throat turned
    inward. <b>Sink it in water</b> off a bank, bait it, and walk away: it fishes on its own while you
    are elsewhere, holds ${p(A.creel.hold??0)}, and gives about <b>${p(Math.round(1/sn))} fish to a baiting</b> before the bait is
    worked out of it. Empty it from the bank. Kept baited and emptied, the best one that can be woven is
    worth around ${p(Math.round(vr/45*$t(V)))} fish an hour for no work at all.
    A net a Tailor with Fisher's Friend knotted hauls ${v((_i(`Fisher's Friend`)[`catch:fishing_net`]??1)-1)} more fish on the
    average, and a creel of theirs is ${v((_i(`Fisher's Friend`)[`catch:creel`]??1)-1)} likelier to take one at each look.</p>
    <p>The <b>Wadd</b>, being the one thing on the island that swims, now fishes: set one to a deed or a
    work post and it works the banks in its range and carries the catch home.</p>
    <h3>Fruit trees</h3>
    <p>${u(Ri.length)} of the ${p(_e.length)} trees bear. <b>Apple</b> and <b>olive</b> grow wild here and there in
    the warm low country of any island, and the rest are each held to one island of the chart, where they
    grow among the apples and olives: <b>cherry</b> on East Isle,
    <b>pear</b> and <b>quince</b> on the Crescent, <b>pomegranate</b> and <b>apricot</b> on the Northwest
    Steppe, <b>plum</b> in the lowland of the Northeast Tundra, <b>lemon</b> on Volcano Isle, <b>peach</b>
    on Middle Isle and <b>fig</b> on West Skerry. An island of your own has no chart and grows them all.
    You can tell a fruit tree across a field by what is hanging in it. Take a <b>sprout</b> off one
    with forestry and plant it, and you have the beginnings of an orchard, wherever the sprout came
    from. A <b>plucka</b> set to work on a deed picks what the bearing trees have on them and carries
    it to the crate.</p>
    <p>A sapling bears nothing; leave it to grow. A mature tree gives about ${p(3)} of its fruit to a
    picking and an old one about ${p(5)}, more as your forestry rises, and a picked tree needs a few
    minutes before there is anything on it again. ${f(h(`apple`,F(`make_apple_pie`,`apple`)))} and a dough bake into ${p(I(`make_apple_pie`))} <b>apple
    pies</b>, the best food on the island; ${h(`cherry`,F(`make_cherry_preserves`,`cherry`))} boil down into ${p(I(`make_cherry_preserves`))} jars of <b>preserves</b>;
    and ${h(`olive`,F(`press_olives`,`olive`))} crushed under a <b>quern</b> give ${p(I(`press_olives`))} measures of <b>olive oil</b>, which keeps almost
    for ever.</p>
    <p>All of them are also <b>woods</b>, and good ones: apple is as hard-wearing as oak and takes a finer
    edge, cherry is the best handle wood on the island, and olive is murder to work and outlasts
    everything. You get one log a tree, so an orchard felled is an orchard gone.</p>
    <p>A Forester can learn these jobs of the woods. <b>Coppice</b>, with a hatchet, cuts a mature or older
    tree back to young for ${p(pi(`Coppice`).coppice??0)} logs and leaves it standing to grow on.
    <b>Tap resin</b>, with a carving knife, takes ${p(pi(`Tap Resin`).tap_resin??0)} tar from a living
    ${_e[gt].name.toLowerCase()}, once a day for each; the day turns when the woods do. <b>Clear brush</b>,
    with a sickle, clears every bush and reed in the ${mi}&times;${mi} tiles around the one you choose
    in one go, and leaves ${xe[Re[_.Bush]].name.toLowerCase()} where the bushes were and
    ${xe[Re[_.Reed]].name.toLowerCase()} where the reeds were.</p>
    <h3>Farming</h3>
    <p>With a <b>rake</b> in your pack, <b>Till</b> any grass or dirt to rake it into a field. Seeds turn
    up while foraging and botanizing &mdash; vegetables and starches in the one, spices and fibres in the
    other &mdash; and a field's menu offers to <b>Sow</b> whichever you carry. A crop goes through ${p(Ht.length)}
    stages: ${c(Ht)}, each drawn differently, and every crop takes its own time
    per stage, from quick mint to slow corn.</p>
    <p>Each stage can be <b>Tended</b> once, and tending is what makes a field pay: an untended crop
    gives ${w(0).produce} crop and ${w(0).seeds} seed, while one tended at every stage gives <b>${w(3).produce} crops and ${w(3).seeds} seeds</b>. Tending
    and tilling both train <b>Farming</b>, and your farming skill sets the quality of what you harvest.
    Harvesting leaves the ground still tilled, so a field can be sown again without raking it afresh
    &mdash; which is what lets a Seavic keep one running on its own.</p>
    <p>A Farmer can learn to work a patch at a time: <b>Sow a patch</b>, <b>Tend a patch</b> and <b>Harvest
    a patch</b> each take the ${vi}&times;${vi} tiles around the field you choose as one job, in the time of
    ${p(3)} of the one-field job. Sow a patch sows the seed you choose on every empty field in it, one
    seed a field; Tend a patch tends every crop in it not yet tended at the stage it is at; Harvest a patch
    harvests every ripe crop in it, each for what its own tending earned. A crop keeps the pace it was sown
    at, so a field a Farmer sowed faster grows faster whoever harvests it.</p>
    <h3>Campfires and cooking</h3>
    <p>Right-click any dry, open spot and choose <b>Build campfire</b> to lay one from ${p(2)} shafts; it
    fills a ${p(2)} by ${p(2)} block of the tile's spots. Feed it anything that burns &mdash; thatch, shafts,
    planks, peat, timbers, logs or coal &mdash; and each is worth so many minutes of burning, then
    <b>Light</b> it. Peat is dug off a peat bed with a shovel and costs nothing but the digging, which
    makes it the first fuel worth stacking. A burning
    fire is the place to <b>Cook</b>: raw meat becomes cooked meat that fills ${v(g(`cooked_meat`).food??0)} of the food bar where
    raw fills ${v(g(`meat`).food??0)}, potatoes bake
    in the embers, onions and nuts roast, and with a <b>clay bowl</b> you can stew berries into compote
    or simmer meat and vegetables into a proper stew. Cooking recipes sit in the crafting window with
    everything else and unlock when you stand by a lit fire; burning a dish costs you the ingredients,
    so cook where your skill can manage. A fire burns its fuel down in real time and goes cold when it
    runs out, and an unlit one can be taken apart to get the wood back.</p>
    <h3>Grain, the quern and bread</h3>
    <p>Wheat and corn are not food until they have been through a <b>quern</b>: stones dressed flat,
    grooved and pierced, chiselled out of ${P(`make_quern`)} by a stonecutter. Turning it is the
    <b>Milling</b> skill. ${f(h(`wheat`,F(`make_flour`,`wheat`)))} grind down to a lot of <b>flour</b>, ${h(`corn`,F(`make_cornmeal`,`corn`))} to <b>cornmeal</b>,
    and a badly ground batch is nothing but grit.</p>
    <p>Flour and a bucket of water are worked into <b>dough</b> &mdash; ${p(I(`make_dough`))} rounds at a time, and the
    bucket comes back empty &mdash; and a round of dough baked on a hot stone at a lit fire is
    <b>bread</b>, which is the first food that keeps and travels. Cornmeal boiled in a clay bowl makes
    ${p(I(`make_porridge`))} bowls of <b>porridge</b>. Both are cooking rather than milling: the mill only makes the meal.</p>
    <h3>The oven</h3>
    <p>A campfire will cook, but it burns as much as it bakes. An <b>oven</b> is laid by a
    <b>mason</b> from ${P(`make_oven`)} with a trowel, set down on a block of
    ${p(S(`oven`).w*S(`oven`).h)} spots. Feed it anything a fire takes, peat and coal included &mdash; it holds ${m(bn)} of
    it &mdash; and light it. A lit oven is a cooking fire for every purpose: everything on the Cook menu
    is there, and anything that would have burnt over an open flame comes out right, and better, because
    the bricks hold their heat evenly. It leaves ashes like any other fire, and they rake out the same
    way.</p>
    <h3>Metal</h3>
    <p>Mining a seam brings up <b>ore</b>, not finished metal. A <b>stone smelter</b> is laid up by a
    mason from ${P(`make_smelter`,!0)} with a trowel &mdash; it is built in the crafting window like
    anything else, carried, and <b>set down</b> on ${p(6)} spots of a tile on your own deed. Take it up again
    whole when it is cold, empty and raked out. It turns ore into lumps.
    Feed it the same fuel a campfire takes (coal burns longest), light it, and charge it with ore: each
    piece takes its own time to run, longer for fine ore and stubborn metal, shorter in a better
    smelter. Draw the lumps off when they are done.</p>
    <p>Lumps of the same metal gather into one larger lump whose quality is the average of what went in,
    weighted by size, so a poor lump drags a good stack down. At a hot smelter you can also mix
    <b>alloys</b> &mdash; bronze, brass, pewter, electrum and <b>steel</b>, which is ${P(`make_steel`)}
    &mdash; and their quality comes from the
    metal you put in rather than from your hands; skill only decides how little is lost in the pouring.</p>
    <p>Sand fired in a smelter makes <b>moulds</b>: an anvil mould, a pan mould, heads for rakes,
    shovels, hatchets, pickaxes and knives, a sword blade and a helm. A mould wears every time it is
    filled and <b>cannot be mended</b>; a fine one is simply good for more fillings before it cracks
    through. Pour metal into an <b>anvil mould</b> at the smelter and it cools into an anvil of that
    metal, which you set down on ${p(4)} spots of a tile.</p>
    <p>Every other mould is <b>poured at the smelter</b> too, with the metal of your choosing, and cools
    into a <b>casting</b> of the piece &mdash; a shovel head casting, a nail casting &mdash; that comes out
    with the lumps. A casting is carried to an <b>anvil</b> and beaten true there, using
    <b>blacksmithing</b>, <b>weaponsmithing</b> or <b>armoursmithing</b>, whichever that piece calls for.
    The skill decides whether the piece comes out at all and how good it is, alongside the casting, which
    carries the quality of the mould and the metal it was poured from, and the anvil. Tool heads and
    blades are finished by fitting a shaft to them. A sword hits far harder than any working tool, and a
    helm turns aside most of what a cornered animal does to you when you attack it.</p>
    <p>A Smith with <b>Ingots</b> pours ${p(5)} lumps of one metal into an <b>ingot</b> at the
    smelter (<b>Pour ingots</b>). It weighs ${t(i)} what its lumps did and counts as all ${p(5)} of
    them wherever the smelter, the anvil, a recipe or Improve takes lumps; what a job does not use of one
    comes back as lumps. A weapon or tool finished by a Smith with <b>Temper Bath</b> can be <b>quenched</b>
    once, by that Smith or another with the perk, from its menu, standing at water or beside a barrel or a
    well of it, for the quality its maker's mark says; Examine shows it.</p>
    <h3>Hunting and butchering</h3>
    <p>Wild wildermon can be <b>attacked</b> from their menu; an edged tool in your pack hits far harder
    than bare hands, and timid creatures bolt when hurt, so expect a chase. Whatever kills one leaves a
    <b>corpse</b> on the ground. Right-click the tile and choose <b>Butcher</b> for meat, fur, <b>hide</b>,
    bone and the occasional gland. The <b>Butchering</b> skill and a <b>butchering knife</b> both decide
    how much of the carcass is worth keeping: bare hands waste most of it. Corpses rot, so do it soon.
    Every carcass you butcher raises the Butchering skill, and the skill sets the <b>QL</b> of everything
    that comes off it. With a knife of QL <i>n</i> it comes off at your Butchering <i>n</i>% of the time,
    and otherwise at the knife's QL times ${b.toFixed(1)} to ${(b+or).toFixed(1)}, never above
    your Butchering; with bare hands it comes off at your Butchering times ${b.toFixed(1)} to
    ${(b+or).toFixed(1)}, plus 1. The menu's <b>Butcher</b> line says the range for the knife you carry.
    A hide off a carcass is <b>raw</b> and no use for anything until it has been through lye.</p>
    <h3>Looking inside a building</h3>
    <p>Once anything is built, a small strip of arrows appears at the right-hand edge. It picks the
    <b>storey you are looking at</b>: the ceilings above it are lifted off so you can see straight down
    into that floor, and everything above it goes with them. The label reads <i>1st</i>, <i>2nd</i> and
    so on, and clicking it returns to <i>Auto</i>, which simply follows whichever storey you are
    standing on. <kbd>Page Up</kbd> and <kbd>Page Down</kbd> do the same as the arrows.</p>
    <p>The <b>◪</b> button beside them, <kbd>X</kbd>, or the matching box in Settings, <b>cuts away the
    walls facing you</b> &mdash; the ones standing between your eye and the inside of a building &mdash;
    leaving the far walls in place so the rooms still read. Together they let you look into any
    floor of a tall building from outside it.</p>
    <h3>Settling and building</h3>
    <p>Carve a <b>deed stake</b> from a shaft with a carving knife, then use it where you stand to
    found a settlement: ${Mi} by ${Mi} tiles
    around a stone token. You may hold one settlement at a time, and building is only allowed
    on its land. Things left outside on deed land rot ${s(1/te)} slower.</p>
    <p>To build, flatten and pack a tile, then with a mallet choose <b>Plan building</b> on it and
    <b>Add to building</b> on neighbouring flat packed tiles. Point at a tile's edge and <b>Plan wall</b>
    there: solid, window, bay window, door or double door, in log, plank, timbercraft, cobblestone,
    slate, marble, sandstone, stone brick, clay adobe, clay bricks, ornate silver or ornate gold. Then
    <b>Build wall</b> feeds it materials one at a time. Floors are planned the same way and laid with
    the paving skill. Another storey can only be planned once every wall of the storey below is built, up to ${p(10)} in all.
    On an upper storey, plan a <b>staircase</b> or <b>ladder</b> instead of a plain floor to climb up:
    walk onto it from below and you are upstairs, step off it toward the ground and you are down again.
    Once the top storey's walls are done you can <b>Plan roof</b> tile by tile; neighbouring roof tiles
    join into ridges and hips.</p>
    <p><b>Fences, gates and half walls</b> are the same work at a fraction of the cost, and they do not
    need a building around them: point at the edge of any tile &mdash; on your deed or a mile from it,
    on packed ground or in the long grass &mdash; and choose <b>Plan fence</b>. A log fence is ${p(ce(`log`,`fence`).needed.log)} logs
    where a log wall is ${p(ce(`log`,`solid`).needed.log)}; a half wall is ${t(pe.get(`half_wall`)?.factor??0)} of one. Both stop anything alive at that border,
    yourself included, which is how a paddock holds a Roxxen; a <b>fence gate</b> is the one kind you
    can walk through. Feed them materials with <b>Build fence</b> exactly as you would a wall, and take
    them down again from the same menu. Nothing rests on waist-high work: a storey cannot be planned
    over a run of fence or half wall, so if you want a floor above, the wall below has to be a wall.</p>
    <p>Materials: saw logs into planks and timbers, bundle cut grass into thatch, mix clay and sand
    into mortar, press clay and grass into adobe, and chip silver and gold from veins in the mountains.</p>
    <h3>Nails, furniture and storage</h3>
    <p>Anything that is nailed together needs <b>nails</b>, and nails need metal. Fire a <b>nail mould</b>
    from sand at a smelter: it is a gang mould with ${p(5)} channels in it, so one lump of metal
    poured into it there and beaten out on an anvil gives ${p(5)} nails at ${p(Math.round(g(`nail`).weight*1e3))} grams apiece. Crates, tool heads fitted to their
    shafts and every piece of furniture take them; sawing planks, carving shafts and bundling thatch do
    not, so the early game needs no smith.</p>
    <p><b>Fine carpentry</b> is the furniture hand, separate from the carpentry that cuts the wood. With
    a mallet, planks, timbers, shafts and nails it builds ${p(Si.length)} pieces &mdash;
    ${c(Si.map(e=>e.name.toLowerCase()))}. Each is carried like a crate and
    <b>set down</b> on a block of subtiles: right-click a tile and choose <b>Set furniture down</b>, and
    the piece follows the cursor until you click it down &mdash; <b>Q</b> and <b>E</b> turn it ${t(1/wi)}, Escape
    keeps it. A piece stands the way it was set however the view is turned, and <b>Turn it</b> on a standing
    piece turns it ${t(1/wi)} round. Staircases and ladders are planned the same way, Q and E
    choosing the side you climb from.</p>
    <p>${u(Ci.length)} of them hold things: ${c(Ci.map((e,t)=>`${e.name.endsWith(`s`)?``:`a `}${e.name.toLowerCase()} ${t===0?`takes `:``}${e.capacity}`))},
    where a plank crate takes ${Pn.plank.capacity}. The <b>larder</b> is the only one of them that is fussy: it takes food and drink, raw
    or cooked, and the flour, dough and cornmeal a kitchen bakes from &mdash; and nothing else.
    Right-click one and <b>Open</b> it to see inside, or
    stand beside it and choose <b>Put away</b> on anything you are carrying. Nothing can be picked up
    again until it has been emptied.</p>
    <p>A stack <b>dragged</b> out of the inventory window and let go over a crate, a cart, a wagon or a
    piece that holds things goes into it whole, under the same rules as <b>Put away</b>. If it is out of
    reach you walk to it first. A trash crate and a market stall do not take a drop.</p>
    <h3>Calling things by name</h3>
    <p>A settlement of any age has bins, crates and a row of chests, and every one of them is
    called <i>Raw material bin (oak)</i>. Any crate, bin, chest, cart, piece of furniture, work post or trap
    will take a name of its own: its menu offers <b>Give it a name</b>, and after that the name is what
    it is called <b>everywhere</b> &mdash; in the Stores window, in the settlement window, in its own
    menu, and when you point at it. Answering with nothing takes the name off again. It is the
    difference between hunting through the lot and walking to the one marked Planks.</p>
    <p>A <b>sign</b> (${P(`make_sign`,!0)}) and a wider <b>signboard</b> (${P(`make_great_sign`,!0)})
    are boards made to be written on. Set one up, give it a name, and the name stands
    in the world above the board where anyone walking past can read it &mdash; which is what a fork in
    a road wants.</p>
    <h3>Bags</h3>
    <p>${u(xi.length)} things hold other things and are carried in your pack:
    ${c(xi.map(e=>`a <b>${g(e).name.toLowerCase()}</b> of ${P(`make_${e}`,!0)} (${g(e).holds} things)`))}.
    Open one from its entry in your pack, or use <i>Put it in a bag</i> on anything you are
    carrying; <i>Empty it out</i> turns the whole thing back into your pack.</p>
    <p>What is in a bag is <b>out of reach</b> until it comes out again &mdash; no recipe will draw on it
    &mdash; and one bag will not go inside another. What a bag is for is that it <b>sheds the
    weather</b>: drop a full one on the ground and what is inside rots at
    ${c(xi.map((e,n)=>`${t(g(e).shelter??1)}${n===0?` the rate`:``} in a ${g(e).name.toLowerCase()}`))}.
    A backpack of food and tools left at a work post keeps far better than the same things thrown down beside it.</p>
    <h3>Work posts</h3>
    <p>A <b>work post</b> is a settlement's worth of orders on a stake. Build one from <b>${P(`make_work_post`,!0)}</b>
    with a mallet, then right-click a spot on any tile
    <b>outside your own borders</b> and drive it in &mdash; inside them the token already gives the
    orders, so it refuses.</p>
    <p>Set <b>one</b> wildermon to it from the post's own menu and it works out of the post exactly as it
    would work out of a settlement: the same job, the same wage of skill, only measured from the post
    instead of the token. A post is a work site rather than a settlement, so it holds its creature on a
    short rein &mdash; <b>${it(1)} tiles round a rough post and ${it(V)} round the best</b>, however much the creature
    itself has learned. Anything with room in it standing inside that circle is where the loads go, so a
    crate beside the post makes a camp that keeps itself; leave the post bare and everything is carried
    all the way home.</p>
    <p>Nothing holds a post up and it <b>rots where it stands</b>: <b>${m(ze)}</b> for the
    roughest and <b>${m(En)}</b> for the best that can be made, leaning further as it goes, with one
    word of warning near the end. When it falls over, whoever was working out of it <b>comes back to
    you</b> if you are walking alone; otherwise it <b>goes back to work on your settlement</b>, or into
    an empty <b>creature crate</b> in your pack if you have no settlement, and off into the wild if you
    have neither. You can also pull a post up before it goes, and what comes up is as worn as it had
    become.</p>
    <p>A wildermon on a post is <b>not</b> on the settlement's books, so it costs none of the working
    slots your deed level allows. That, and the fact you can put one down anywhere, is what a post is
    for: a logging camp in a far wood, a digger on a clay bank, a Snout turned loose over an old ruin
    &mdash; for as long as a stake in wet ground lasts.</p>
    <h3>Raw materials, worked materials, seed, sprouts, rubbish, and something to pull it in</h3>
    <p>More things to put things in, each for a job a chest does badly.</p>
    <p>A <b>raw material bin</b> holds <b>${S(`bulk_bin`).capacity}</b> of what comes out of the ground, off a tree, out of a
    vein or off a beast unworked &mdash; ore, logs, dirt, sand, clay, shards, wool, hides &mdash; and
    refuses everything a bench, a kiln or a smelter has touched: no bricks, planks or lumps, and no
    food. It is where a mine's output goes.</p>
    <p>A <b>craft material bin</b> is its opposite number, off the same bill of materials, and takes
    exactly what the other one refuses: planks, nails, ribbons, hinges, lumps, bricks, cloth, arrows
    &mdash; every material a bench, a kiln or a smelter has turned out, and nothing else. Between them
    the bins take every material in the game, and neither takes a tool, a crop or a meal.</p>
    <p>It is the first of the ${p(Mt.filter(e=>e.heft).length)} stores that <b>do not count what is in them</b>. It weighs it:
    <b>${ki} kg</b>, which is ${p(Math.round(ki/g(`nail`).weight))} nails or ${p(Math.round(ki/g(`plank`).weight))} planks, and there is no
    limit on the number of things at all. Built of a stronger wood it holds proportionally more, the way
    every other store does. It is where a forge's and a carpenter's output goes.</p>
    <p>A <b>seed bin</b> and a <b>sprout bin</b> are the small pair, ${p(S(`seed_bin`).w*S(`seed_bin`).h)} subtile each, ${P(`make_seed_bin`)}
    apiece. Both weigh what is in them rather than counting it: the seed bin <b>${Ai} kg</b>, which is
    ${Math.round(Ai/g(`wheat_seed`).weight)} wheat seeds or ${Math.round(Ai/g(`potato_seed`).weight)} seed potatoes, and the sprout bin <b>${ji} kg</b>, which is
    ${Math.round(ji/g(`sprout`).weight)} sprouts. The seed bin takes the
    ${p(Wt.size)} sowable seeds and nothing else; the sprout bin takes sprouts and nothing else.</p>
    <p>A <b>trash crate</b> is built with a rotten bottom on purpose: anything put in it rots <b>${s(S(`trash_crate`).trash??1)}
    faster</b> than it would out in the rain, and is gone in minutes. <b>Put away</b> never picks
    it, whatever you are standing beside; you have to choose <b>Throw it in the trash</b> on the thing
    itself, so nothing goes in by accident.</p>
    <p>A <b>small cart</b> holds ${S(`cart`).capacity} things and, once you <b>take hold of it</b>, follows you wherever
    you go until you <b>let go</b>. Load it at the mine and walk home. Only one cart at a time, and it
    will not follow you into water or up anything it cannot roll over.</p>
    <h3>Bridges</h3>
    <p>Water and ravines have been walls: the island is full of places you can see across and cannot get
    to. A <b>bridge</b> is a run of deck from one piece of solid ground to another at much the same height, and
    once it is finished it is simply ground &mdash; you walk it, you ride it, and depending on what it is
    made of you drive a cart over it.</p>
    <p>Stand on one bank and right-click the other: <b>Throw a bridge across from here</b>. It must run
    straight (north, south, east or west), both ends must be dry ground you can stand in the middle of,
    the ends must be within ${p(12)} height units of each other, and everything between must be at
    least ${p(3)} units below the deck &mdash; a gap, not a slope. ${u(Object.keys(Un).length)} kinds:
    ${c(Object.values(Un).map(e=>`a <b>${e.name.toLowerCase()}</b> (${ae(e.bill)} a span${e.tool===`trowel`?`, with a trowel`:``}) goes <b>${p(e.span)}</b> tiles and ${e.carts?`carries a cart`:`takes foot traffic only`}`))}.</p>
    <p>A planned bridge is built a span at a time, exactly as a wall is: stand by the open part and feed
    it what it wants, one unit a go. Until the last span is decked nothing crosses. Pulling one down
    again gives you half of what went into it. A boat passes underneath.</p>
    <h3>Boats</h3>
    <p>${u(Ti.length)} hulls, all of them a carpenter's work. A <b>rowing boat</b> is ${P(`make_rowing_boat`,!0)};
    she carries <b>${Ei.capacity} things</b>, wants <b>${p(Ei.boat?.draught??0)} deep</b> of water under her and is rowed, so your
    <b>body strength</b> is the engine. A <b>sailing boat</b> is ${P(`make_sailing_boat`,!0)};
    she carries <b>${Y.capacity}</b>, wants <b>${p(Y.boat?.draught??0)} deep</b>, and the wind
    does the work, so it is <b>body control</b> that decides how much of it you waste. A <b>caravel</b> is
    ${P(`make_caravel`,!0)}, and she takes a whole tile; she carries <b>${X.capacity}</b>, wants
    <b>${p(X.boat?.draught??0)} deep</b>, makes <b>${X.boat?.speed}</b> tiles a second at a fair effort to the
    sailing boat's <b>${Y.boat?.speed}</b>, and carries <b>${p(X.boat?.passengers??0)} passengers</b> besides
    whoever has her helm.</p>
    <p><b>Launch</b> her by setting her down on water deep enough while you stand on the bank &mdash; she
    will not go on land and will not go in a puddle. <b>Climb aboard</b> from the shore and she moves
    with you, over any water with depth enough and over nothing else: no beaching, no dragging her over
    a sandbar. <b>Step ashore</b> puts you on the nearest dry ground, and refuses if there is none within
    reach, so bring her in before you get out.</p>
    <p><b>Passengers.</b> Stand beside a caravel and <b>Come aboard as a passenger</b>: you take the first of her
    ${p(X.boat?.passengers??0)} places on deck that is free, and from then on you go where she goes and your own
    feet go nowhere. <b>Step ashore</b> works for a passenger as it does for the helm. Anybody on her deck may
    <b>Take the helm</b> when nobody holds it, or when whoever held it has gone away and left her at sea; nobody
    takes it out of the hands of somebody who is here. She is not picked up or turned with anybody aboard.</p>
    <p>What a boat is really for, besides the coast itself, is the water under it. A line cast over the
    side of a boat in deep water reaches everything that swims &mdash; pike and sturgeon
    included &mdash; which no bank on a shelving shore will ever do.</p>
    <h3>Wind, and how a sail uses it</h3>
    <p>The wind has a direction and a strength and neither of them is yours. Both wander &mdash; it may
    be a flat calm at one hour and a gale later the same day &mdash; and it is worked out from the clock,
    so it is the same wind for anybody who was there at that hour and it is a different wind on a
    different island.</p>
    <p>A <b>rowing boat</b> ignores all of it: oars are oars. A <b>sailing boat</b> lives on it, and far
    more on the <b>angle</b> you hold than on the strength. Across the wind is fastest; before it is
    steady and slower; hard up into it is hard work; and inside the last ${p(Math.round(yt*180/Math.PI))} degrees she is
    <b>in irons</b> &mdash; the sail shakes, she makes almost no way at all, and the only way to get
    somewhere upwind is to <b>tack</b>: sail as close as she will lie on one side of it, then bear away
    and do the same on the other. A sailing boat of quality ${$.ql} with body control 20 at the tiller, in
    ${He($.force)}, makes ${Wi} tiles a second on a beam reach, running, close-hauled and in irons.</p>
    <p>The bars show the wind whenever you are under sail: an arrow flying with it, what it is called,
    where it is out of, and what point of sail you are on. The sail on the boat goes out on whichever
    side the wind is and empties when you point into it.</p>
    <p>A sailing boat <b>holds ${p(Y.capacity??0)} things</b>, crates included, and that is what she is for
    &mdash; but a hull loaded to her marks is ${v(nr)} slower than one running empty.</p>
    <h3>Why a road is worth its stone</h3>
    <p>Feet hardly care what is under them: sand is walked at ${v(R(_.Sand).speed)} of the pace of grass and laid
    stone at ${v(R(_.Slabs).speed)}, and only a bog really tells, at ${v(R(_.Marsh).speed)}. A <b>laden wheel</b> cares about very
    little else. An empty cart rolls over anything at its own pace; a full one is held to what the ground
    will take, and between empty and full it is a straight blend, so a half-loaded cart pays half.</p>
    <p>Stone slabs and cobble cost a full wagon <b>nothing</b>. Packed dirt costs ${t(z(_.PackedDirt))}, bare
    grass ${t(z(_.Grass))}, sand ${t(z(_.Sand))}, a tilled field ${t(z(_.Field))}, and a <b>bog ${t(z(_.Marsh))}</b>. What a full
    wagon crosses in a minute on a paved road takes it <b>${m(Ui(_.Grass))} over grass and
    ${m(Ui(_.Marsh))} through marsh</b> &mdash; which is the whole argument for paving, and why the stone is
    worth cutting.</p>
    <p>Walking somewhere with a load routes you the way a carter would take it: round the bog and along
    the stone, even when the stone is the longer way about. An empty cart still cuts straight through.
    The hud says what the ground under you is costing whenever it costs anything.</p>
    <h3>Large carts and wagons</h3>
    <p>A small cart is a barrow you pull yourself. The ones that follow are <b>driven</b>: a wildermon
    goes in the traces, you sit on the seat, and what is on the back weighs nothing at all as far as the
    wheels are concerned.</p>
    <p>Both are <b>rough carpentry</b> rather than fine, and both are built out of parts:</p>
    <ul>
      <li><b>Large wheel</b> &mdash; ${P(`make_large_wheel`,!0)}, with a mallet.</li>
      <li><b>Big axle</b> &mdash; an <b>axle mould</b> ${Hi(`axle_mould`)}.</li>
      <li><b>Metal ribbon</b> &mdash; a <b>ribbon mould</b> ${Hi(`ribbon_mould`)}.</li>
      <li><b>Yoke</b> &mdash; ${P(`make_yoke`)}, stitched with an awl. One per hitch.</li>
    </ul>
    <p>A <b>large cart</b> takes ${P(`make_large_cart`,!0)}. It holds <b>${Di.capacity} things of any weight</b> and has ${p(Di.vehicle?.yokes??0)} yokes:
    ${p(Di.vehicle?.needs??0)} wildermon will move it, ${p(Di.vehicle?.yokes??0)} move it faster.</p>
    <p>A <b>wagon</b> takes ${P(`make_wagon`,!0)}. It holds <b>${Z.capacity} things</b> and will not stir until
    <b>${Z.vehicle?ft(Z.vehicle):``} yokes</b> have a wildermon in them.</p>
    <p>Set one down, stand beside it and <b>hitch</b> a tamed wildermon from its menu &mdash; one you
    have with you or a deed worker; one in a creature crate is let out of it first. Then <b>take the reins</b> and drive. How fast you go is the team's business and nothing
    else's: a quick animal gets there sooner, more of them pull better than fewer, and a hungry one
    drags its feet, so feed the team before it goes in. A Seavic pair will outrun you at a walk; ${p(Z.vehicle?.needs??0)}
    Quarra will not, but they will shift ${p(Z.capacity??0)} bricks.</p>
    <p>The team is not only the pace but the pitch: a draught beast trains <b>climbing</b> by hauling
    over bad ground, and what the team knows between them decides both how fast the wheels turn and how
    steep a step they will take. A green pair balks at a bank a worked pair goes straight up.</p>
    <p>Wheels keep to open ground: no fords, no stairs and nothing steeper than a horse would take. They
    go indoors on the ground floor through an <b>arch</b>, a <b>double door</b> or a <b>gate</b>, and never
    through a plain door. You
    cannot pick a vehicle up with anything on it or anything in the yokes.</p>
    <p>A beast in the traces <b>stays hitched until somebody takes it out</b> &mdash; one at a time from
    its own menu, or the whole team from the vehicle's. Until then it stands at the vehicle and goes
    where the vehicle goes. It does not follow you, work, answer the bell or wander; it cannot be put
    in a crate, set to a post, released or culled; <b>it does not get hungry</b>, though feeding it
    still fills it; and <b>nothing picks it as a target</b>.</p>
    <p>A vehicle is <b>anybody's to use</b>. Whoever built it and whosever ground it stands on, anyone
    standing at it may take the reins, take hold of a cart, hitch to it, take a beast out of it, load it,
    empty it or pick it up.</p>
    <p>While you have the reins of a cart or wagon, or a small cart by the shafts, <b>whatever you gather
    goes into it</b>: ore, stone and gems from mining, dirt, sand and clay from digging, logs, sprouts,
    forage and herbs, fruit, a harvest, a catch, what you butcher and what you shear. It fills the cart as
    far as it has room, and what does not fit goes in your pack, with one line to say the cart is full. A
    boat is not a cart: what you gather in one goes in your pack.</p>
    <h3>Water: the well and the barrels</h3>
    <p>Until now water meant walking to the shore. A <b>well</b> is a mason's job &mdash; ${P(`make_well`)}
    &mdash; and once it is sunk it <b>draws its own water</b>, a little
    at a time, up to <b>${S(`well`).well} litres</b>. How fast depends entirely on how well it was built: a poor shaft
    trickles, a fine one keeps up with a settlement. Fill a bucket or a waterskin at it exactly as you
    would at a shore, or <b>drink from it</b> where you stand.</p>
    <p><b>Barrels</b> hold liquid and nothing else, in ${p(Oi.length)} sizes:
    ${c(Oi.map((e,t)=>`<b>${e.name.toLowerCase()}</b> (${e.liquid}${t===0?` litres`:``})`))}. One barrel holds one liquid &mdash; water or lye, not
    both. <b>Pour</b> a full bucket in and you get the empty bucket back; point at a stack of them and
    the whole lot goes in one after another. Filling a bucket beside a barrel draws out of the barrel,
    so a large barrel of lye is a tannery's worth of work waiting to be done.</p>
    <h3>Rest, and what the cooking is for</h3>
    <p>Sleeping in a bed banks <b>rest</b> &mdash; ${t(It)} the night at a perfect bed and less in a poorer one,
    up to ${m(Ve)} of it held at a time. Rest burns only while you are actually working, and everything you
    do while it burns <b>teaches you ${s(2)} as much</b>. The hud shows how much you have left.</p>
    <p>Every cooked dish <b>favours one trade</b>, and eating it leaves a <b>knack</b> for that trade
    for a while &mdash; ${s(1+Dt)} as much, for anything from ${m(Bi)} to ${m(Vi)} by how
    filling the dish was and how well it was made. It is the same kind of thing a long day at a trade
    leaves behind, with the one difference that a knack off the table wears off and a knack earned at
    the work never does. Which dish favours which trade is settled when the island is
    raised and never changes on it, and every island settles it differently, so <b>examine</b> a dish to see what it is
    good for. A second helping of the same thing puts the clock back rather than stacking. That is what
    the stews and the bread and the cheese are for: not the food bar, which a raw potato would fill, but
    an afternoon of carpentry that teaches you ${s(1+Dt)} as much.</p>
    <h3>What is actually in a meal</h3>
    <p>Filling the food bar takes a raw potato. Eating <i>well</i> is a different question. ${u(Rt.length)} things
    a body wants are kept separately under the food bar, each fed by different food and each falling
    away on its own over <b>${m(et)}</b>:</p>
    <table>
      <tr><td><b>Starch</b></td><td>bread, porridge, roots and grain</td></tr>
      <tr><td><b>Flesh</b></td><td>meat and fish &mdash; cooked, meat is worth ${s(B(`cooked_meat`,`flesh`)/B(`meat`,`flesh`))} raw</td></tr>
      <tr><td><b>Fat</b></td><td>oil, nuts, cheese and what is fried in them</td></tr>
      <tr><td><b>Greens</b></td><td>vegetables, fruit and berries</td></tr>
    </table>
    <p>Raw food feeds one of them a little: a potato is ${v(B(`potato`,`starch`))} starch, a piece of
    meat ${v(B(`meat`,`flesh`))} flesh. A <b>cooked dish feeds several, and feeds them properly</b> &mdash; bread is
    ${v(B(`bread`,`starch`))} starch, cooked fish ${v(B(`cooked_fish`,`flesh`))} flesh and ${v(B(`cooked_fish`,`fat`))} fat, and a <b>stew</b> is the only thing on
    the island that feeds all ${p(Rt.length)} at once. Better cooking fills them fuller, so quality tells here as
    everywhere.</p>
    <p>What comes of it: anything in you at all <b>holds hunger and thirst off</b>. On a full board
    they fall at <b>${t(1-Ft)}</b> of their ordinary pace, which is ${m(.5/(Ge*(1-Ft)))} rather
    than ${m(.5/Ge)} before the hunger bar is down to half. And a board with <b>all of them</b> full makes
    everything you do teach you <b>${t(st)} more</b> &mdash; but that one reads off whichever of them
    is <b>shortest</b>, so every one of them full but one empty is worth nothing at all. Bread and nothing
    else buys you nothing; it is the spread that pays.</p>
    <h3>Money, and four ways to spend it</h3>
    <p>Coins have been struck on this island since there was an anvil to strike them on, and until
    now they have bought nothing at all. One number settles it: <b>a gold coin is worth ${p(Ni)}
    silver</b>, every price is named in silver, and change comes back in silver. Paying takes your
    largest coins first, so ${p(Ni+1)} silver out of a gold and ${p(Pi)} leaves you the ${p(4)} rather than
    breaking the small change.</p>
    <p>Goods change hands in the ways below, each the answer to a different question, and a board
    finds what is for sale and what is wanted. The <b>Market</b> window (<kbd>U</kbd>) holds all of them.</p>
    <p><b>The market board</b> is read at a settlement token or a mailbox: every stall on the island,
    where it stands, whose it is, what is for sale on it and at what price, nearest first. Buying is
    done at the stall: stand at its counter and press <b>Buy</b>, and the price comes out of your
    purse and goes into its till.</p>
    <p><b>A deal</b> is for when you are both there. Tick what you are giving, name what you want
    for it, and choose who: the offer goes out with its terms written down, and whatever you put up
    is held out of your pack while it stands, so nothing offered can be eaten, sold or promised
    to anybody else. They take it whole or turn it down whole — there is nothing to re-read at the last
    moment — and you can take it back until they answer. You both have to be within a few tiles to
    shake on it.</p>
    <p><b>A stall</b> is for when you are not there. Nail one up, put goods on the counter, set a
    price on each, and it sells while you are asleep: the coins go into its till and wait for you.
    It is the only thing on this island that does anything for you while you are away, and it is
    the whole reason coins are worth striking. What is on it comes back off it for its owner alone;
    anybody else buys it. A thing taken back off the counter is not for sale again until it is
    priced again.</p>
    <p><b>A buy order</b> is for what nobody has put out. At a settlement token or a mailbox, on the
    <b>Orders</b> tab, name a kind of thing, the lowest quality that will do (nought takes any), how many,
    and the silver you will pay for each: the whole price comes out of your purse there and then and is
    held against the order, which goes on the board after the stalls with your name and where you put it
    up. Anybody else at a token or a mailbox can fill it, all of it or some, and is paid out of what it
    holds at once. The island chooses what goes out of their pack: anything of that kind, whatever it is
    made of, at that quality or better, the poorest first &mdash; never anything locked, worn or in hand,
    held out in a deal, or with something inside it. What they bring comes to you by the post and waits
    at any mailbox, and you are told. Take an order back whenever you like, from anywhere, and what it
    still holds comes back to your purse; one left open for <b>${m(Je)}</b> lapses and gives
    it back by itself. Nobody fills their own.</p>
    <p><b>A parcel</b> is for when neither of you is there. A letter has carried ${p(400)}
    characters and nothing else; it carries things now, posted at a <b>mailbox</b> and drawn out at
    any other. Both ends want a box — without one you may still write, and nothing but words will
    cross the island. A parcel is the other person's from the moment it goes in.</p>
    <p><b>A wildermon</b> changes hands in its creature crate: in a deal, on a stall and in the post,
    and on a stall in no other store. Whoever the crate goes to keeps the wildermon in it. While the
    crate is on offer, on a stall or in the post it cannot be opened, and what is in it cannot be let
    go or culled.</p>
    <h3>Who may do what on a settlement</h3>
    <p>Being asked onto somebody's land used to be all or nothing: everybody on the roll could dig
    up the gardens, empty the stores and pull the walls down. There are ${p(on.length)} standings now.</p>
    <table>
      <tr><td><b>Founder</b></td><td>Planted the stake. Everything, and the master key to every lock on their own land.</td></tr>
      <tr><td><b>Mayor</b></td><td>Everything but founding: builds, and asks people in and out.</td></tr>
      <tr><td><b>Builder</b></td><td>The ordinary citizen, and what an invitation makes you: shapes the ground, builds, takes from the stores.</td></tr>
      <tr><td><b>Guest</b></td><td>Walks the land and shapes nothing. What you offer somebody you want to show round.</td></tr>
    </table>
    <p>A guest still belongs to the settlement — they may walk it, and their wildermon still work
    there — they simply may not dig it up. Pointing at any ground says whose it is and what you are
    on it, which is also how you read a <b>stranger's</b> settlement from outside: its name, who
    founded it, and that you may walk it and shape nothing.</p>
    <p>And a building on a settlement is every builder's to work on, not only its planner's, so
    several people can fill one wall's bill between them.</p>
    <h3>Padlocks and keys</h3>
    <p>Everything anybody built has been open to everybody who could walk to it. A crate on your own
    deed was safe because the <i>ground</i> was yours; a crate anywhere else, a cart at a work post,
    a cupboard in a house you had invited somebody into, was a thing anybody could empty.</p>
    <p>A <b>padlock</b> is forged at a smelter and comes with no key. <b>Fit</b> it to a crate or a
    piece of storage furniture and it closes and cuts <b>one key</b> to itself, there and then. A key
    is an ordinary item: hand it over and you have handed over what it opens, and there is no list
    anywhere saying you did. Take the padlock off and the key goes with it.</p>
    <p>On a <b>ship, a wagon or a cart</b> a padlock locks more than the hold: without its key
    nobody takes the helm or the reins, takes hold of the shafts, comes aboard as a passenger or
    picks it up to carry it off. Stepping ashore and getting down are never refused.</p>
    <p>One way back in, because losing a small item should not cost you a building: the
    <b>founder</b> of the settlement a store stands on may open anything on their own land. So a
    padlock is worth a great deal on somebody else's deed and rather less on your own.</p>
    <h3>Where the animals live</h3>
    <p>Everything wild has <b>a home</b>: a patch of country it keeps to, set where it was first
    put down. It wanders about that ground and turns back when it strays too far, so the places you
    learn to go for a particular animal stay the places you go for it.</p>
    <p>Grazers keep company. One that arrives near others of its kind takes <b>their</b> ground for
    its own, so you find them together and they move together — a herd, made without anybody
    writing a list. Hunters do not: each keeps its own range, because what makes a hunter
    frightening is meeting it where it lives rather than meeting a pack of them.</p>
    <p>That changes what running from one is like. A hunter gives up when it has run the length of
    its leash <i>or</i> when it has come as far from its own ground as it is willing to — whichever
    happens first. So one you walk in on at its den will chase you a long way, and one you meet at
    the edge of its range gives up quickly, because it is already nearly as far out as it goes.
    Either way it turns for home afterwards rather than staying where it stopped.</p>
    <h3>The field guide</h3>
    <p>The <b>Field guide</b> window (<kbd>F4</kbd>) has a page for each of the ${p(ct().length)} kinds of
    creature there are, and marks which of them you have <b>seen</b>, <b>tamed</b> and <b>bred</b>. A kind is seen once one
    has stood out of a crate somewhere you could see it, which counts what your own wildermon and your settlement see for
    you; tamed once an offering takes, or you get one out of a trap; bred once a young one is born to a dam you keep. Taming
    or breeding one marks it seen as well, and the first time you see a kind the event log says so. The index draws every
    kind you have seen and leaves the rest as a shadow of their shape, and over it says how far along you are: seen out of
    all ${p(ct().length)}, tamed and bred out of the ${p(ct().filter(Gt).length)} that
    can be, since a monster cannot. A kind's page says where the wild puts it down and how far it keeps from its home, how
    often the wild's roll comes out as it, the taming it asks and what it takes from your hand, what it does for you once
    it is yours, what it is like to meet and what a carcass gives &mdash; all of it read off the rules. <b>Field guide</b>
    on any creature's menu opens its page. Alone, the book is kept in your save; on an island the island keeps it, and
    takes a kind you have seen only while one is standing within ${p(40)} tiles of you.</p>
    <h3>What the island will not tell you</h3>
    <p>A handful of rules here are real, load-bearing, and findable only by being refused or by
    making a great many of something and noticing. They are worth knowing up front.</p>
    <p><b>Your skill is the ceiling; your tool decides how often you reach it.</b> Nothing you make
    is ever better than your hands. A go rolls against the quality of the tool: land it and the
    piece comes out at your skill, miss it and the piece comes out at roughly what the tool is
    worth. The copper chisel you washed ashore with is quality ${p(Be(`chisel`))}, so it reaches your ceiling
    about one go in ${p(Math.round(100/Be(`chisel`)))}. That is the whole reason to better a tool, and every recipe row in
    <b>Crafting</b> (<kbd>R</kbd>) now says what it would come out at and marks the ones where the
    tool rather than your hands is the thing in the way.</p>
    <p><b>A job that costs no wind and takes no time teaches your body nothing.</b> Examining a
    tile, locking a chest, naming a thing, choosing a stance — all free, all instant, and none of
    them exercise. Only work that costs something teaches anything.</p>
    <p><b>A cart needs an opening it fits through.</b> A person turns sideways through a single
    door; wheels do not. A double door, an archway or a gate is what a cart, a wagon or a team
    needs, and a fence with no way through it is a cart trap.</p>
    <p><b>Everything rots where it lies.</b> A deed slows that to ${t(te)}, a roof over a closed
    room slows it to ${t(we)} again, and a crate or a sack slows it further still. A pile of planks
    left in a field is a pile of planks you are going to lose.</p>
    <p><b>A refusal is information.</b> Nothing here fails silently: when a job will not go, the
    line in <b>Trouble</b> says which tool, which material, which skill or which distance is
    wrong. It is nearly always quicker to try the thing and read the refusal than to guess.</p>
    <h3>Walking, running, and looking into a room</h3>
    <p>A <b>run is not a walk gone faster</b>. Anything covering ground quickly — you on a good
    road, a mount at full stretch, a hunter closing on you — reaches further with each step,
    drives back harder than it recovers, leans at the ground ahead of it and leaves the ground
    between footfalls. Nothing has to be switched on: it is read from how much ground the thing is
    actually covering, so every animal and every person on the island has it.</p>
    <p>And standing <b>inside a building</b>, the walls between you and the camera fade — the walls
    of <i>your room</i>, not of the whole house, so the far end of a longhouse keeps its own and
    you can still tell where the building is. <kbd>X</kbd> is still there for taking every near
    wall away at once, everywhere.</p>
    <h3>Walking away from a job</h3>
    <p>Walking somewhere <b>puts the work down</b> rather than forgetting it. Whatever was in hand
    goes to the front of the list with however many goes it had left, everything queued behind it
    stays queued, and the bar says how many are waiting. Nothing starts itself again — being
    dragged back across a yard you crossed on purpose would be worse than losing the list — so
    press <b>Carry on</b> on the bar, or <kbd>B</kbd>, when you want them back. <kbd>Esc</kbd>
    still forgets the lot, which is what <kbd>Esc</kbd> has always been for.</p>
    <h3>Improving up to a quality</h3>
    <p>Asking for a number of passes is asking for a number nobody can work out: what a pass is
    worth falls away as the piece gets better, so the last few points of quality take many times the
    passes the first few did. An item's <b>Improve</b> menu offers <b>Up to…</b> instead — name a
    quality and it works until it gets there and then stops. It stops early, and says so, if your
    hands top out first.</p>
    <h3>Finding things in a store</h3>
    <p>A crate, a cupboard, a cart and a bag all have a <b>search box</b> and the same
    <b>ordering</b> the pack has: by name, quality, weight, damage or how many. A deed crate holds
    ${Pn.plank.capacity} things of every sort the deed turns up, so it is the store that needed it most.</p>
    <h3>What you can hear</h3>
    <p>The island makes a noise now, and what the noise is depends on what is being hit.
    <b>Footfalls</b> take their sound from the ground: grass is a brush with no edge on it, sand
    is sharper, laid stone is a hard click, a plank deck answers under you with a note
    in it, and snow is a squeak. Water closes over a boot rather than being stepped on.</p>
    <p><b>Work</b> is the same idea: the trade decides, because a mason is hitting stone whatever
    he is making out of it. A spade going into clay, a point cracking into rock, an axe biting a
    trunk, a hammer on an anvil — the anvil is the loud one, and the only thing in the game with a
    real ring to it.</p>
    <p>Everything is placed where it is happening, and the <b>camera is the ear</b>: a smelter you
    have walked away from goes quiet, and so does one you have merely looked away from, because
    both pan and volume are measured off the screen. Pull the view back and the whole island gets
    further away and quieter together.</p>
    <p>Nothing here is a recording. Every sound in the game is made out of filtered noise and a
    handful of oscillators at the moment it is wanted, which is why there is nothing to download.
    <b>Settings</b> (<kbd>O</kbd>) has the volume at the top of the Display tab; sliding it to
    nothing turns the island off entirely.</p>
    <h3>Light after dark</h3>
    <p>Night takes <b>${t(Et)}</b> of your sight, which is enough to be a reason to stop walking.
    ${u(ne.length)} things go in your hand against it.</p>
    <p>A <b>torch</b> is ${h(`cloth`,F(`make_torch`,`cloth`))} wound round the head of ${h(`shaft`,F(`make_torch`,`shaft`))} (${_r(`make_torch`)}) and is
    the poor relation in every way that matters: <b>${p(n(H))} to ${p(n(V))} tiles</b> of light
    for <b>${m(Ne(H))} to ${m(Ne(V))}</b>, by how well it was wound, and when it is
    done it is gone &mdash; there is nothing left to refill. What it has over a lantern is that anybody
    can wind one in the first hour of a new island, which is exactly when the dark is worst.</p>
    <p>A <b>lantern</b> (${P(`make_lantern`)} &mdash; ${_r(`make_lantern`)}) takes a <b>candle</b>
    drawn from beeswax and yarn. A better one keeps the draught off the flame and throws further:
    <b>${p(re(H))} tiles and ${m(ee(H))}</b> to a candle at the roughest,
    <b>${p(re(V))} tiles and ${m(ee(V))}</b> at the best.</p>
    <p>Either is <b>lit at a fire</b> &mdash; a campfire, a kiln, a smelter or an oven you are standing
    at, or off something already alight in your own hand. Both burn <b>only while lit</b>, so carrying a
    dark lantern costs nothing but its weight, and both say so when they go out.</p>
    <p>Carrying one lit gives back <b>${t(Jt)}</b> of what the dark takes from your sight, and its
    own reach is a <b>floor</b> under your sight however black it gets: you can always see as far as the
    thing in your hand throws.</p>
    <p>Everything else that burns casts a circle too: a <b>lit campfire</b> ${p(5)} tiles, an
    <b>oven, kiln or smelter</b> in blast ${p(4)}, and the ${p(br.length)} creatures that carry a
    light of their own as far as it reaches &mdash; ${c(br.map(e=>`a ${e.name.toLowerCase()} ${p(e.glow??0)}`))}.
    Each one burns a soft-edged hole in the night with a little firelight in it. None of this is worked
    out at all while the sun is up.</p>
    <h3>Night, and a bed to wake in</h3>
    <p>The island keeps a clock, shown beside your position: a full day and night passes in
    <b>${m(tn)}</b> of real time, ${m(tn/24)} to the game hour. The sun goes down at
    <b>${yr(21)}</b> and comes up at <b>${yr(3)}</b>, so <b>${t(Sr)} of it is day and
    ${t(1-Sr)} night</b> &mdash; ${m(tn*(1-Sr))} of real time dark in every day
    &mdash; and the light goes over the ${p(2)} game hours around sundown and comes back over the
    ${p(2)} around sunrise.</p>
    <p>A <b>bed</b> or a <b>cot</b> is worth more than the corner it stands in. Choose <b>Make this your
    home</b> and it becomes the place you wake up &mdash; whatever happens to you, wherever it happens.
    Choose <b>Sleep until morning</b> after dark and you wake with your wind back and some of your hurt
    mended; a well-made bed is a better night than a thin cot. Playing on your own you wake at
    <b>${yr(3+Pt)}</b>, and the world has not waited for you: fires burn down, crops come on,
    kilns finish and everything left outside ages by however long you were under. On an island the
    night is everybody's and one sleeper cannot skip it, so you wake rested with the clock where it was.
    You wake up hungry and thirsty, too.</p>
    <p>A Tailor can learn to make a <b>tent</b>: ${P(`make_tent`)}, with a needle. Set it down anywhere and sleep in it
    as in a bed: a night in it rests you ${v((S(`tent`).bed??0)/(S(`bed`).bed??1))} as well as the same night in a bed of its quality.</p>
    <h3>Finding things, and moving them in bulk</h3>
    <p>A settlement of any age has crates, bins, chests and carts all over it, and opening all of them
    to find the planks is no way to live. The <b>Stores</b> window (<kbd>U</kbd>) lists every container
    you own, nearest first, with how full each is and what is in it. Type what you are after and it
    narrows to the stores that have it and says how many; <b>Walk there</b> takes you, and <b>Open</b>
    opens it when you are already standing at it.</p>
    <p>At the foot of any open container, <b>Take all</b> empties it into your pack, <b>Put all in</b>
    puts everything loose in your pack into it, and <b>Put in what it holds</b> puts in only the kinds
    already in there, which is how a store is topped up without emptying your pack into it. Nothing
    <b>kept back</b> and nothing worn moves either way.</p>
    <p>The <b>inventory</b> can be ordered by name, quality, weight, damage or how many, and grouped by
    kind or run together in one flat list.</p>
    <p><b>Pick up everything here</b> sweeps the tile you are standing on and the ${p((2*cr.SWEEP+1)**2-1)} around it in
    one go, nearest pile first, rather than one entry per pile.</p>
    <h3>Keeping something back</h3>
    <p>Right-click anything in the pack and choose <b>Keep this back</b>. A kept thing is never spent: no
    recipe takes it, no hook baits with it, nothing is fed it, and it cannot be dropped. It can still be
    <b>worked with</b> &mdash; that is the point, so your best hatchet can chop all day without a craft
    quietly eating it &mdash; and <b>Put it back in the pack</b> undoes it. Kept things read
    <i>kept back</i> in the list.</p>
    <h3>What your back will take</h3>
    <p>You carry <b>120 kilos</b> plus <b>${p(5)} kilos</b> for every point of <b>body
    strength</b>, so 220 at the start and ${120+W*5} at ${p(W)}. Going over it costs, and
    the cost climbs with how far over you are: everything past the mark slows you and every action
    takes more wind, as armour does &mdash; ${p(Cr)} kilos past a starting back drags on you like about
    ${p(Math.round(Cn(Cr,220)/wr))} full suits of iron plate. Past <b>${s(fr)}</b> your limit you are down to
    <b>${t(Yt)} of your pace</b>. The inventory footer turns red and says by how much, and the bars
    say so too.</p>
    <p>The damage column turns <b>amber past 75</b> and <b>red past 90</b>, so a tool about to go to
    pieces says so where you are looking rather than only in the log.</p>
    <h3>Eating, and keeping your things</h3>
    <p>The <b>Eat</b> button beside the food bar eats the best thing you are carrying, and the
    <b>Feed</b> button on your companion's line gives it the <i>poorest</i> thing it will take, so the
    good food stays in your pack. Both are there to save hunting through the inventory.</p>
    <p><b>Tools wear out</b>, slowly. Every use puts a little damage on whatever tool the work called
    for, and a poor tool goes to pieces far faster than a good one &mdash; which is most of what quality
    is for: a copper tool is good for about ${p(Tr(H))} jobs at quality ${H} and ${p(Tr(V))} at
    ${p(V)}, and what it is made of stretches or shortens that. Damage also makes a tool work as though it
    were poorer than it is. Past <b>75 damage</b> it warns you in red, and again at every
    ${p(5)} points after; at 100 it breaks and is gone.</p>
    <p>Right-click anything damaged and choose <b>Repair</b>. It is its own skill: the work goes on a go
    at a time, taking damage out and a little quality with it, and you can stop whenever you like.
    Taking ${p(Er)} damage out of a tool is ${p(Or(U(`repair`)))} goes at repair ${U(`repair`)} and costs it
    ${kr(U(`repair`))} of quality; at repair ${Dr} it is ${p(Or(Dr))} goes for ${kr(Dr)}.
    Nothing is repaired once it is down to quality 1, so a thing mended often enough is finished in the
    end &mdash; but that is a long way off, and a good tool kept mended will outlast most of what you
    build with it.</p>
    <p>A Tailor can learn to <b>Patch</b> cloth and leather armour instead: one cloth or one leather, of the piece's own
    stuff, takes ${_i(`Patch`).patch_item??0} damage off it at a go and none of its quality.</p>
    <h3>Wounds, herbs and covers</h3>
    <p>A blow is not only a number off the bar. What gets through your armour leaves a <b>wound</b>, of
    a kind, in whichever place it landed, and that wound has its own life: it <b>bleeds</b> until it is
    dressed, it goes <b>bad</b> if it never is, and nothing on you knits at all while something is still
    open. The bars panel lists what you are carrying, worst first, and says what each one wants.</p>
    <p>${u(Ar.length)} kinds, and each has a herb that suits it:
    ${c(Ar.map((e,t)=>`a <b>${e.name}</b> ${t===0?`wants `:``}<b>${e.herb}</b>`))}. What leaves which
    is what hit you &mdash; a hoof bruises, a claw opens, a sting goes deep and narrow, and
    ${c(xr.map(e=>`the ${e.name.toLowerCase()}`))} burn.</p>
    <p>A wound is dressed with a bandage or a cover. A <b>bandage</b> is cloth cut ${p(I(`make_bandage`))} to a length with a knife; a
    <b>healing cover</b> is the herb itself, bruised into cotton, ${p(I(`make_cover_${Ar[0].herb}`))} to a batch on the
    <b>first aid</b> skill. Put on cleanly, either stops the bleeding and puts back between ${v(tr(U(`first_aid`),H))} and
    ${v(tr(W,V))} of your health at once, by your first aid and its quality. Right-click either
    and it goes on the worst thing open.</p>
    <p>What is on a wound decides how fast it closes and whether it turns. Under cloth it closes
    ${s(he/ge)} as fast as with nothing on it. The <b>right herb</b> puts back
    ${s(Zt)} as much at once, closes it ${s(Me/he)} as fast as cloth, and it <b>never
    turns</b>; the wrong herb puts back ${s(mn)} as much and closes it ${v(ue/he-1)} faster than cloth.
    Cloth leaves ${v(Ae)} of an open wound's chance of going bad, the wrong herb ${v(ie)}.
    And every ${p(Math.round(le/Ee))} points of <b>chirurgy</b> closes every wound on you as fast again as
    it closed at none.</p>
    <p>A wound that has <b>gone bad</b> is a different problem: it drains rather than closes and no
    dressing will hold on it. Scour it out with a bucket of <b>lye</b> first &mdash; a hard piece of
    first aid, and it leaves the wound open and bleeding again, so dress it straight after.</p>
    <p>The same hands do as much for a hurt <b>wildermon</b>. Stand beside a tame one that has been in
    a fight and choose <b>Treat its wounds</b>: it takes a bandage and puts back the same share of its
    whole health, which is far more forgiving than waiting for it to mend itself. A wild creature will
    not stand still for you.</p>
    <h3>Dying, and your grave</h3>
    <p>When your health runs out you <b>die</b>, and wake on the shore you first came in on with every
    wound closed. <b>What you were carrying stays where you fell</b>, in a <b>grave</b> dug on that spot:
    the pack, whatever was in your hands, the toolbelt, and every bag with what is in it. What you wear
    stays on you &mdash; clothing, armour and a jewel &mdash; and so do a crate with a wildermon in it and
    anything you have offered in a deal. Go down in water too deep to stand in and the grave is on the
    nearest dry ground within <b>${p(3)} tiles</b>, or where you fell if there is none.
    Carrying nothing, you leave no grave.</p>
    <p>For <b>${m(Qn)}</b> of real time, whether or not you are playing, it is yours and
    nobody else's: only you can open it or take anything out of it, and nobody can pick it up or break
    it &mdash; anybody who tries is told whose it is. Open it the way you open a chest and take things out
    one at a time, or choose <b>Take everything</b>; nothing goes back in. When the time is up it
    <b>crumbles</b>, and whatever is still in it goes with it. Every death digs a grave of its own, and
    each is marked on your map until it crumbles.</p>
    <h3>What quality is worth</h3>
    <p><b>Your skill is the ceiling and your tool is the chance of reaching it.</b> The quality of the
    tool in your hand is the percentage chance that a piece of work comes out at your skill in that
    trade. Every other go comes out at what the tool itself is worth &mdash; ${jr} its quality,
    and never above your skill. The hatchet you washed ashore with is quality ${Be(`hatchet`)}, so
    ${t(Be(`hatchet`)/V)} of your logs come out at your skill. Nothing you make is ever finer than
    the hands that made it, so a fine tool in a beginner's hands still only makes beginner's work
    &mdash; it just stops wasting the material.</p>
    <p>Work done with no tool at all &mdash; picking berries, tending a field &mdash; has nothing to
    roll against and comes out at ${jr} your skill, plus 1.</p>
    <h3>Rare things</h3>
    <p>Now and again a thing comes off the bench better than the hands that made it had any right to
    produce. About ${c(G.map((e,t)=>`<b>one thing in ${p(Math.round(1/Se(e)))}</b> ${t===0?`is `:``}<b>${l[e].name}</b>`))}.
    Nothing brings it on &mdash; not skill, not tools, not the metal &mdash; and nothing you do can make
    it more likely; you make ${p(Math.round(1/Se(l.length-1)))} ordinary things and find that you have one.</p>
    <p>A rare thing is <b>better at whatever it was for</b> by ${c(G.map(e=>t(l[e].boost-1))).replace(/ and ([^,]*)$/,` or $1`)}
    &mdash; an edge that bites, armour that turns aside more, a tool that works truer &mdash; <b>wears and rots
    at ${c(G.map(e=>v(l[e].keep)))}</b> of an ordinary one's pace, and can be <b>improved past the
    ceiling of your own skill</b> by ${c(G.map(e=>String(l[e].ceiling))).replace(/ and ([^,]*)$/,` or $1`)}.</p>
    <p>Anything that <b>holds things</b> holds more of them: a bag, a crate, a cupboard, a weight
    bin, the charge a smelter will take and the load a kiln will fire all go up by
    ${v(a)} a step &mdash; ${G.map(e=>`<b>${v(a*e)}</b>`).join(`, `)}
    for rare, supreme and fantastic, and never less than <b>one more unit a step</b>, so a kiln's
    ${p(16)} becomes ${c(G.map(e=>p(Te(16,{rare:e}))))}. A rare thing keeps
    the room when you set it down, and keeps it again when you pick it back up.</p>
    <p>They are written in their own colour in your pack, and on the ground they <b>shine</b> in it:
    a few slow motes for a rare thing, more over a bloom for a supreme one, and a gold bloom under a
    turning star for a fantastic one, which you can pick out across a field.</p>
    <h3>Improving</h3>
    <p>A finished thing can be made better than it was made. Right-click it and choose <b>Improve</b>:
    each pass eats a little stock, and a success raises the quality &mdash; a great deal at first and
    very little near the end. A failure marks the piece instead, and once it is knocked about past
    10 damage you must <b>Repair</b> it before you can work on it again.</p>
    <p><b>The kit you came ashore with cannot be improved.</b> It is issued gear, serviceable and no
    more: mend it as often as you like, but there is nothing in it to work up. The first real job on
    this island is making your own tools and then bettering those, because every quality roll you will
    ever make is a roll against the tool in your hand.</p>
    <p><b>What you need depends on what it is made of.</b></p>
    <table>
      <tr><td><b>Metal</b></td><td>A <b>file</b> and a <b>whetstone</b>, and a lump of metal per pass</td></tr>
      <tr><td><b>Wood</b></td><td>A <b>carving knife</b> and a <b>file</b>, and a plank or shaft</td></tr>
      <tr><td><b>Cloth</b></td><td>A <b>needle</b>, and a length of cloth</td></tr>
      <tr><td><b>Leather</b></td><td>An <b>awl</b> and a <b>needle</b>, and a piece of tanned leather</td></tr>
      <tr><td><b>Stone</b></td><td>A <b>chisel</b> and a <b>whetstone</b>, and shards</td></tr>
    </table>
    <p>A <b>whetstone</b> is chiselled from ${P(`make_whetstone`)}, and a <b>needle</b> and an <b>awl</b> are
    carved from bone with a knife, so cloth, leather, wood and stone can all be bettered long before you
    have a forge. A <b>file</b> is poured from its own mould at the smelter and beaten out at an anvil,
    which is what gates metal.</p>
    <p>The skill the work is judged by is the one that would have made the thing &mdash; blacksmithing
    for tools, weaponsmithing for weapons, chain and plate armoursmithing for their armour, bowyery for
    bows, tailoring, leatherworking, carpentry, fine carpentry and stonecutting for the rest &mdash; and
    <b>nothing can be improved past that skill</b>, or past 10 while the skill is lower than that.
    Improving raises the skill as you go, so a long session lifts its own ceiling a little.</p>
    <h3>Ashes, lye and tanning</h3>
    <p>Nothing burns away to nothing. Any fire that has been alight a while &mdash; a <b>campfire</b>, a
    <b>smelter</b> or a <b>kiln</b> &mdash; leaves <b>ashes</b> under it, one lot for every
    ${m(1/Qt)} it burns, and you can <b>Take ashes</b> from it whether it is lit or cold. They pile up
    while you work, so a smelter you have been running all morning is worth raking out.</p>
    <p>A <b>bucket</b> is ${P(`make_bucket`)} with a mallet. Stand at any shore and <b>Fill</b>
    it; on dry land it will not fill. ${f(p(F(`make_lye`,`ash`)))} lots of ashes leached into a bucket of water make a
    <b>bucket of lye</b> &mdash; that is the <b>Alchemy</b> skill. Lye is sharp stuff and one bucket does
    one skin. <b>Empty</b> a bucket at any time to get the plain bucket back.</p>
    <p><b>Tanning</b> is leatherworking: a raw <b>hide</b>, a bucket of lye and a carving knife. The lye
    takes the hair off, you work the skin soft, and it comes out as <b>leather</b> with the bucket
    empty in your hand again. Leather is what every leather thing is cut from &mdash; cap, jerkin,
    sleeves, trousers and boots &mdash; and what an awl and needle work into a leather piece when you
    improve it. Fail the tanning and the hide is left too long and spoils, so tan where your skill can
    manage it.</p>
    <h3>Reeds, papyrus and books</h3>
    <p>The <b>reed beds</b> along the shallows are worth cutting. Take a knife to one and you get
    reeds; cut it again too soon and there is nothing left to take. ${f(h(`reed`,F(`make_papyrus`,`reed`)))} soaked in a bucket of
    water, split, laid crosswise and pressed give ${p(I(`make_papyrus`))} sheets of <b>papyrus</b>, which is the
    <b>Papyrusmaking</b> skill.</p>
    <p><b>Ink</b> is the alchemist's part: a gland &mdash; the rare thing off a carcass &mdash; ground with
    ${p(F(`make_ink`,`ash`))} lots of ashes into a bucket of water, for ${p(I(`make_ink`))} lots of ink.
    ${f(p(F(`make_book`,`papyrus`)))} sheets, ${p(F(`make_book`,`leather`))} leather boards, a lot of ink and a needle bind into a <b>book</b>.</p>
    <p>Right-click a book and <b>Study</b> it. Each go takes ${m(bt(Mr))}, raises <b>mind logic</b>, which is
    what decides how many jobs you can keep in your head at once, and wears the pages a little. Held in
    one hand it is hard going; at a <b>lectern</b> you get ${s(2)} as much out of the same go.</p>
    <h3>Titles and knacks</h3>
    <p>A long climb leaves titles and knacks behind it, and neither is asked for. Every trade hands out a
    <b>title</b> at ${c(nt.map(String))} &mdash; ${$e(`carpentry`).map(e=>e.name).join(`, `)}
    &mdash; and you wear <b>one at a time</b>, chosen in the Skills window (<kbd>K</kbd>) and shown
    beside your position. Click the one you are wearing to take it off again.</p>
    <p>A <b>knack</b> comes of the work itself: <b>one go in ${p(mr)}</b>, at any trade and at any
    level, leaves one behind. It lands on the trade you were working ${t(Ot)} of the time, and
    otherwise on one of the trades beside it &mdash; a long day of carpentry may leave you better at
    bowyery, because it is the same hands and the same wood. A knack is worth ${t(mt)} more on
    everything that trade teaches you from then on, it never wears off, and a trade holds
    <b>${p(5)}</b> of them: ${s(1+5*mt)} on every gain, for good. They stack with a night's rest
    and with what you have eaten, and the Skills window shows how many each trade has.</p>
    <p>Because it is luck rather than levels, a knack can land at any moment and the well never runs
    dry: the last hour at a trade is as likely to leave one as the first. Nothing is owed to
    you at a round number, and nothing stops coming once the early levels are behind you.</p>
    <p>A cooked dish leaves a knack too, and a stronger one &mdash; ${s(1+Dt)} rather than
    ${t(mt)} more &mdash; but it wears off, in ${m(Bi)} to ${m(Vi)}. One is earned and kept;
    the other is eaten and spent. They stack, as does a night's rest.</p>
    <h3>Dye</h3>
    <p>Everything made here comes out the colour of what it was made from: cloth the grey-white of the
    wool, leather the brown of the hide. A <b>dye</b> changes that, and it is the first thing in the
    game that is yours rather than the island's.</p>
    <p>A dye is boiled out of something that grows with a bucket of <b>lye</b> to bite the colour in and
    hold it &mdash; without the lye it washes straight out. ${u(je.length)} of them, easiest first:
    ${c(Nr.map(e=>`<b>${e.name.toLowerCase()}</b> (${e.word}, from ${h(e.from,e.count)}, alchemy ${e.difficulty})`))}.
    One boil gives ${p(I(`make_${je[0].id}`))} pots and hands the bucket back.</p>
    <p>One pot colours one thing. Cloth and leather take dye and metal does not, so that is cloth and
    leather armour, cloth itself, sacks, satchels, backpacks, a saddle, a bridle, a <b>banner</b> and a
    <b>sailing boat</b>'s sail. A dyed chest or leg piece is worn where it shows: your own figure walks
    about in it. A banner is cloth on a staff &mdash; ${P(`make_banner`)} &mdash; planted
    anywhere, and it flies whatever colour you dyed it. Boil it out again in lye if you change your
    mind.</p>
    <h3>Rope</h3>
    <p>Wemp is grown in a field and cut for <b>fibre</b>, and the fibre is spun or laid up. Spun on a spindle it
    is coarse yarn; laid up on a <b>rope tool</b> (${P(`make_rope_tool`)}, carved) it is <b>rope</b> &mdash;
    ${p(F(`make_rope`,`wemp`))} fibres to a rope, on the <b>ropemaking</b> skill. ${f(h(`rope`,F(`make_thick_rope`,`rope`)))} laid up again make a <b>thick
    rope</b>, which is the hawser everything heavy hangs on.</p>
    <p>Rope is not decoration. A <b>bridle</b> takes ${p(F(`make_bridle`,`rope`))} for the reins, a <b>rowing boat</b>
    ${p(F(`make_rowing_boat`,`rope`))}, a <b>sailing boat</b> ${p(F(`make_sailing_boat`,`rope`))} and ${p(F(`make_sailing_boat`,`thick_rope`))} hawsers for her standing
    rigging, and a <b>well</b> ${h(`thick_rope`,F(`make_well`,`thick_rope`))} to hang the bucket down the shaft. Keep a field of
    wemp if you mean to build anything that floats.</p>
    <h3>Wool, cloth and the loom</h3>
    <p>Fibre becomes cloth at a spindle and then at a loom, and each is its own furniture. Build a <b>spindle</b> and a
    <b>loom</b> with fine carpentry, then stand at the spindle to spin wool, cotton or wemp into
    <b>yarn</b>, and at the loom to weave ${p(F(`weave_cloth`,`yarn`))} yarn into a length of <b>cloth</b>. Cloth stuffs a
    mattress, sews into clothing, and twisted into a <b>bowstring</b> it is the start of every bow.</p>
    <h3>Armour</h3>
    <p>Armour is worn a piece at a time in ${p(Pr.length)} places &mdash; ${c(Pr)} &mdash;
    and only counts where the blow actually lands. Right-click anything wearable and choose
    <b>Wear or wield</b>; the inventory marks what is on you.</p>
    <p>There are ${p(Fr.length)} kinds anybody can make, each with a skill of its own that rises <b>by being
    hit in it</b>, and each turns aside a share of a blow before its quality, its metal and that skill:
    <b>cloth</b>, sewn by tailoring, ${v(k.cloth.soak)}; <b>leather</b>, cut from tanned hide with a knife
    by leatherworking, ${v(k.leather.soak)}; <b>chain</b>, poured from moulds and riveted up at an anvil by
    chain armoursmithing, ${v(k.chain.soak)}; and <b>plate</b>, beaten out whole by plate armoursmithing,
    ${v(k.plate.soak)}. Quality and the skill behind it raise all of those, and damage lowers them: armour
    wears where it is struck, and a piece beaten to nothing falls off you. Weight is the price &mdash; a full
    suit of iron plate slows you by ${v(wr/(1+wr))} and makes every action cost ${v(wr)} more
    wind, where cloth costs ${v(k.cloth.burden)}.</p>
    <p>A <b>shield</b> in the off hand is different: it does not soften a blow, it stops the whole of
    one outright, and the shields skill and its quality decide how often. A weapon that takes both
    hands leaves none for one.</p>
    <h3>Weapons and the bow</h3>
    <p>When something bites you, you <b>turn on it</b>: whatever you were doing goes to the front of the
    line and is picked up again after, and you keep swinging until it is dead, gone or out of reach.
    A swing you were already aiming at it is left alone, and nothing tame counts.</p>
    <p>Every weapon belongs to a kind, and each kind is its own subskill: ${c(Ir.map(e=>`<b>${e}</b>`))}.
    Swinging trains the weapon's own subskill and the <b>fighting</b> skill behind it, and both decide
    whether a blow lands and how hard. A weapon's own numbers matter as much: a hunting knife is quick
    and light, a maul or a battle axe is slow and ends things, a spear reaches further than anything
    else held in the hand, and the ones that take both hands take the shield off your arm.</p>
    <p>Heads are poured from <b>moulds</b> at the smelter, beaten true at an anvil and fitted to shafts: short and long sword blades,
    axe and maul heads, spear heads, and a gang mould that turns one lump of metal into
    ${p(ve.find(e=>e.id===`arrow_head_mould`)?.per??0)} <b>arrow heads</b>. A club is simply carved from a log, which is what most people start with.</p>
    <p>Bows are tillered with <b>bowyery</b> from shafts and a bowstring, in ${p(Lr.length)} sizes:
    ${c(Lr.map((e,t)=>`a <b>${g(e.id).name.toLowerCase()}</b> ${t===0?`reaches `:``}${p(e.range??0)}${t===0?` tiles`:``}`))},
    each slower to draw and heavier in the hit than the last. Arrows are made with <b>fletching</b> from
    ${P(`make_arrows`)}, ${p(I(`make_arrows`))} to a go &mdash; and feathers come only off a bird:
    ${c(Rr.map(e=>`the ${e.name}`))}. With a bow in hand, <b>Shoot</b> appears on any wild creature
    in range; the far end of the range is a far harder shot than the near end, and every shot spends an
    arrow.</p>
    <h3>Stonecutting</h3>
    <p><b>Stonecutting</b> is the skill that turns what a pickaxe brings out of the rock into something
    square. With a chisel, rock, slate, marble and sandstone shards become <b>bricks</b> &mdash; what
    walls, smelters and kilns are built from &mdash; or, ${p(F(`make_stone_slab`,`rock_shards`))} shards at a time, a <b>slab</b>. Slabs are
    not for building: they are paving. Choose <b>Pave (slabs)</b> on any tile with a trowel in hand and
    the slab goes down as a floor of that stone, and each of the ${p(me.length)} looks quite different from the
    others. Breaking paving up with a pickaxe usually lifts a slab out whole. Masonry still lays the
    stone; stonecutting is what cuts it.</p>
    <h3>Pottery and the kiln</h3>
    <p>Clay is dug from a clay pit with a shovel, and everything made of it is shaped cold and soft.
    <b>Pottery</b> shapes clay into <b>unfired</b> bricks, bowls, pots and jars, and green ware is no use
    to anybody: it will not hold a stew and it will not hold up a wall. Build a <b>kiln</b> from
    ${P(`make_kiln`)} with a trowel, carry it, and set it down anywhere the ground is dry and
    flat; take it up again when it is cold and empty. Feed it anything a fire takes, peat and coal
    included, pack the green ware in, and light it: each piece needs its own time at heat, and a
    well-built kiln works faster and keeps more of the potter's quality. Take the fired ware out and the
    bowl will cook, the pot makes pottage, the jar puts up preserves, and the brick will build.</p>
    <h3>Digging up the past</h3>
    <p>People lived here before you did and left their things in the ground. Right-click any soil or
    sand and choose <b>Investigate</b>: with a <b>trowel</b> and the <b>Archaeology</b> skill you go
    through the topsoil carefully, and now and then it gives up a <b>fragment</b> of something old.
    Ground you have been over is no good again for a while, so keep walking.</p>
    <p>Nothing comes out of the ground whole or sound. A fragment names what it is a piece of and which
    piece it is &mdash; <i>${K.name} ${K.parts-1}/${K.parts}</i> &mdash; and carries a good deal of damage, which
    <b>Repair</b> takes out. There are ${p(x.length)} things under the island, from ${d(x[0].name)} <b>${x[0].name}</b> in
    ${p(x[0].parts)} pieces to ${d(K.name)} <b>${K.name}</b> in ${p(K.parts)}, and a relic is only recognised once your archaeology has
    come far enough to know what it is looking at. The commonplace turns up far more often than the
    rare, and the ground is kind enough to favour a piece you are still short of.</p>
    <p>With every piece in hand, right-click one and choose <b>Restore</b>. That is the
    <b>Restoration</b> skill: a success puts the thing back together, and a failure marks all the
    pieces and leaves you to mend them. What comes out is only as good as the pieces that went in, so
    a careful excavator and a patient repairer make a better relic than either alone. Some of it is
    treasure and nothing more &mdash; a statuette, a bronze mirror, a bone comb, an old lamp &mdash;
    and some of it is an <b>old file</b>, an <b>old blade</b> or an <b>ancient helm</b>, which are the
    real prize: a file before you have a forge to cast one in.</p>
    <h3>Baubles</h3>
    <p>${f(v(wt))} of what a trowel turns up is not a fragment but a <b>tarnished bauble</b>, whole in one
    piece: ${c(Pe.map(e=>`${v(e.odds)} of them ${e.name.toLowerCase()}`))}. Tarnished, it gives nothing. <b>Restore</b> it on
    its own, on restoration, at difficulty ${c(Pe.map(e=>`${e.difficulty} for ${d(e.name.toLowerCase())} ${e.name.toLowerCase()} one`))}; a failure
    damages it, as it does a relic's pieces. What it gives is rolled when it comes clean, with its rarity, and
    written on it: a rare bauble gives ${s(Gn(1))} what an ordinary one rolls, a supreme ${s(Gn(2))} and a
    fantastic ${s(Gn(3))}. Another ${v(vn)} is a <b>Bauble of Regret</b>, whole, which undoes one
    of your trades: see <b>Trades</b>.</p>
    <table>
      ${Pe.map(e=>`<tr><td><b>${e.name}</b></td><td>${u(e.slots)} sockets. ${e.id===`minor`?`1 to 5% less time per action, or 1 to 5% more skill gained, in one of the ${p(Nn.length)} skills an action is done with.`:e.id===`major`?`A 1 to 5% chance of ${s(2)} the yield of each action in one of ${p(Yn.length)} skills: every skill the crafting window makes things with, and ${c(Yn.filter(e=>!zt.some(t=>t.skill===e)).map(e=>be.get(e)?.name.toLowerCase()??e))}.`:`One of: ${c(Ut.map(e=>`+1 ${e.said}`))}.`}</td></tr>`).join(`
      `)}
    </table>
    <p>Set one at the altar of a settlement of yours: <b>Baubles</b> on the altar's menu. Its ${p(Pe.reduce((e,t)=>e+t.slots,0))} sockets
    are the settlement's rather than the stone's &mdash; pick the altar up and set it down again and they are
    still filled &mdash; and its founder, a mayor or a builder may set a bauble into an empty one. Only the founder or a mayor may set one in place
    of another, and the one it replaces is destroyed; nothing set can be taken out again. What is set works
    for the settlement's citizens &mdash; its founder, mayors and builders, not its guests &mdash; on every action
    they do standing on its land. The same kind for the same skill adds up, to at most ${v(Bt.time.cap/100)} less time,
    ${s(1+Bt.learn.cap/100)} the skill gain, and a ${v(Bt.double.cap/100)} chance of ${s(2)} the yield, which a go gets
    all of or none of. The Settlement window adds up what yours give.</p>
    <h3>Wildermon</h3>
    <p>Wild creatures roam the island. The <b>Rabba</b> is a rabbit-like grazer that forages berries when
    hungry; the <b>Vola</b> is a mole-like digger that botanizes herbs and roots instead; the
    <b>Bevere</b> is a flat-tailed gnawer that never settles far from water, eats vegetables and
    starchy things, is placid by nature, and fells trees for its deed, carrying the logs to the crate;
    the <b>Seavic</b> is a squirrel that lives among the trees, eats acorns and nuts, is placid too, and
    runs a farm for its deed &mdash; sowing seed from the crate, tending every stage and carrying the
    harvest back. Seed it has no field to put in goes back to the stores with everything else, so what
    it reaps is on a shelf where you can count it rather than in its cheeks. It cannot rake a field of
    its own, so it only works ground you have tilled. The
    <b>Mola</b> is a heavier mole built around its claws, found sitting on metal, living on spices, and
    working the seams for its deed: it takes the nearest ore no other Mola has claimed, and the quality
    of what it brings back is its own mining skill, up to whatever the seam holds, and it leaves alone
    any metal beyond its skill &mdash; so a fresh one takes copper and coal, and starts on iron the day
    its mining reaches ${zr(`iron`)}. It works <b>${p(10)} units of water</b> deep, the same as you do, and a face it
    cannot stand on it works from the bank beside it: a shore seam is a Mola's to cut, and so is a
    seabed under wading depth. The same goes for a <b>Quarra</b> and plain rock. Its range grows by
    ${O.mola.rangePerStep??10} tiles every 10 levels rather than the usual 10. The <b>Crawler</b> is a broad crab that lives on the
    sand, eats vegetables, and digs sand for its deed &mdash; a clawful at a time, taken from the highest
    corner of the tile and carried to the crate, which is where the sand for mortar and moulds comes from
    once nobody wants to dig it themselves. It is the first of the defensive sort: strike one and it
    comes straight back at you every time, and even a tamed one is never quite tamed, so now and again it
    will round on whoever is standing next to it. A helm turns the worst of that aside. Each of them picks
    that spot clean for a while, exactly as you would. The <b>Quarra</b> is a slab of a creature with a
    jaw made for stone: it sits on bare rock, eats clay, and cuts rock, slate, marble and sandstone into
    shards for the deed, which is what keeps a mason in brick. The <b>Embra</b> sleeps in the peat and
    tar of the marshes, eats nothing that has not been cooked, and keeps every fire, smelter and kiln on
    the deed fed and lit from the crate &mdash; the one chore you otherwise have to come home for. The
    <b>Magga</b> is a magpie that clears a settlement of everything dropped and forgotten and puts it in
    the crate; wild ones do the reverse, so do not leave anything lying about near their trees. The
    <b>Woola</b> is a mild grazer that does no work at all: it grows a fleece, and once it has grown you
    <b>shear</b> it with a knife for <b>wool</b>, which grows back in ${m(1/(O.woola.fleece??1))}. The
    <b>Ulva</b> is the first thing on this island that will come at you unprovoked: it hunts by scent
    from ${p(O.ulva.notice??7)} tiles off and does not stop until you are well away or it is badly hurt. It takes taming
    ${O.ulva.tameLevel} to try, and a tamed one keeps watch over the deed, going for anything wild that crosses the
    border. The
    <b>Roxxen</b> is a slab-shouldered ox that will not start anything and will finish most things that
    start with it. It does no job on a deed; it is there to be hitched, and what it learns in the traces
    (its <b>climbing</b>) decides how fast a cart or wagon goes and how steep a line the wheels will
    take. A green pair labours over ground a worked pair walks up. It also leaves the biggest carcass on
    the island by a long way. The <b>Orse</b> is long in the leg and learns the same skill, in the traces
    or under a rider: stitch a <b>saddle</b> and a <b>bridle</b>, fit both from its menu, and
    <b>mount</b> it. A green one carries you at ${s(Br/fn)} your own pace and over the same ground;
    one whose climbing is worked right up is ${s(Vr/Br)} as fast as a green one and goes up slopes you would
    have to walk round. Tack a Tailor with Saddler stitched lets a mount go ${v((_i(`Saddler`)[`speed:saddle`]??1)-1)} faster,
    past the 5 tiles a second a mount is otherwise held to, and yokes of theirs do the same for the cart or
    wagon built on them. The
    <b>Rowl</b> hunts on sight in the wild &mdash; taming ${O.rowl.tameLevel}, and even then it is unruly &mdash; and
    tamed on a deed it hunts <b>for</b> you: it works a circuit of the token, runs down anything wild
    inside it, and carries the carcasses back to storage for butchering. Its <b>fighting</b> skill is
    both its bite and its beat: it hits ${s(hn(W))} as hard at mastery, and its circuit grows from
    ${p(O.rowl.workRange)} tiles to ${p(O.rowl.workRange+_n(W)*(O.rowl.rangePerStep??10))}. The <b>Noot</b> is a plump upright waddler that
    lives beside the clay pits, eats root vegetables, and digs <b>clay</b> with its bill for its deed,
    carrying it to the crate a load at a time &mdash; which is what keeps a potter in clay without
    walking the shore for it. Carry what the creature eats (a berry or vegetable for
    a Rabba, a spice or vegetable for a Vola), long-press or right-click one and choose <b>Tame</b>: the
    food is used up, success is uncommon at low taming skill, and none of them holds a failed attempt
    against you.</p>
    <p><b>Keep at it.</b> A wild thing that has taken food from your hand and refused you is a little
    readier for the next offering: <b>${v(at)} on the chance</b> for every attempt in a row, with no
    ceiling but the one on the whole chance. It is slight per go and it will not make a hard tame easy, but it
    means a long run of refusals is going somewhere. The run lapses if you leave it alone for
    ${m(Bn)}, and <b>raising a hand to it ends the run outright</b> &mdash; nothing that has been hit
    takes food from the hand that hit it. Examining a wild one says how far you have got with it.</p>
    <p><b>Age.</b> Everything alive was born at some hour and gets older from there. A <b>young</b> one is
    ${v(E.young.scale)} the size, moves at ${v(E.young.speed)} of the pace, grows no fleece and gives no milk, and is no use in the
    traces or under a saddle &mdash; but it has not learned to mistrust you, so it is ${s(E.young.tame)} as easy
    to tame. It is <b>grown</b> after ${m(kn)}, and everything in the book describes it then. After
    ${m(Wn)} it is <b>old</b>: ${v(E.old.speed)} of the pace, ${v(E.old.pull)} of the pull in the traces and
    ${v(E.old.growth)} of the pace growing a fleece back, but heavier, and an old carcass is worth ${v(E.old.yield-1)} more
    than a grown one. The Wildermon window says which
    it is and how long a yearling has left to grow. What was already walking about when the island was
    raised counts as grown.</p>
    <p><b>Putting one down.</b> An animal you keep can be <b>culled</b> from its own menu &mdash; one
    action, wherever it stands, and it leaves the same carcass anything else would. You are asked
    first, and asked harder if its blood is worth keeping, because there is no getting that back.
    <b>Release</b> is the other door out: it walks off into the country with everything it was bred
    for still in it. Neither is open to something in the traces or with you on its back.</p>
    <p><b>The working sorts.</b> More wildermon came out of the same country, and most of them
    are kept for a job. The <b>Bogga</b> wallows in the marshes and cuts <b>peat and tar</b> for the
    deed. The <b>Sedra</b> is a long-necked wader that shears <b>reeds</b> at the water's edge, which is
    where papyrus starts. The <b>Holla</b> carries <b>water</b> in its throat from the shore or a well
    and pours it into your barrels. The <b>Dowse</b> will not live anywhere there is no metal under it,
    and on a deed it <b>reads the ground</b> and marks what is down there. The <b>Sappa</b> buries more
    seed than it eats, and on a deed it <b>plants sprouts</b> where the axe has been. The <b>Cobbe</b>
    carries the <b>hod</b>: brick, mortar and timber out of your stores and into whatever wall you have
    planned, one piece at a time. The <b>Tinka</b> <b>mends</b> the damaged gear in your stores. The
    <b>Middun</b> eats what is rotting on the ground and turns it into <b>compost</b>. The <b>Snout</b>
    smells out <b>buried relics</b> and marks where to dig &mdash; taming ${O.snout.tameLevel}, and worth every point of
    it.</p>
    <p><b>Backs and traces.</b> The <b>Bura</b> does no work but carries <b>${O.bura.pannier} things</b> in panniers on
    its own back; open them from its menu. The <b>Gorral</b> is a horned cliff-goat that takes a saddle
    and goes up ground an Orse turns away from. The <b>Wadd</b> is the one mount that will swim deep
    water with a rider on it. The <b>Shaggan</b> is slower in the traces than anything else and stronger
    than all of them: each adds ${v(O.shaggan.pull??.25)} to a team's pull where most beasts add ${v(yn)}.</p>
    <p><b>Eyes and produce.</b> The <b>Warda</b> is a watcher: keep one and it sees ${O.warda.sight} tiles for you
    wherever it stands. The <b>Quill</b> is a ground-bird you <b>pluck</b> rather than shear, for
    <b>feathers</b>, which is what keeps an archer in arrows. The <b>Cudda</b> is <b>milked</b> into an
    empty bucket, and a bucket of milk presses into ${p(I(`make_cheese`))} <b>cheeses</b>. The <b>Vesp</b> is a swarm
    rather than a creature: build a <b>hive</b> (${P(`make_hive`,!0)}), set it down
    on your deed and keep a tamed Vesp there, and the swarm fills it with <b>honey</b> and
    <b>beeswax</b> &mdash; and ${P(`make_candle`)} draw ${p(I(`make_candle`))} <b>candles</b>. The
    <b>Lume</b> is only ever out after dark and carries its own light about with it: keep one and it
    lights ${p(O.lume.glow??0)} tiles round itself however dark it is.</p>
    <p>Right-click any tile of your settlement for the <b>deed menu</b>: it lists the wildermon kept
    there, sets their <b>orders</b>, offers to <b>upgrade</b> the settlement, and renames or disbands it.
    Orders apply to every wildermon on the deed at once and take effect the moment something wild
    crosses the border: <b>aggressive</b> and they break off work and go for it, <b>defensive</b> and
    they only answer what has already struck at them or at you, <b>passive</b> and they carry on working
    whatever walks in. Each upgrade pushes the
    border out ${p(2)} tiles and lets ${qe(2)-qe(1)===1?`one`:p(qe(2)-qe(1))} more wildermon work the deed, and each is earned by building the
    settlement out: ${Hr}. Upgrades are
    taken in order, so each level only asks for the new thing. The menu ticks off what you have and names what is
    missing, and a settlement goes no higher than level 5.</p>
    <p>A deed worker feeds itself: once its belly falls below ${t(Ct)} it goes to whichever crate on
    the deed holds something it eats, helps itself, and goes back to work. Keep food in a crate and your
    workers will look after themselves.</p>
    <p>A deed worker starts within ${p(Ur[0])} to ${p(Ur[Ur.length-1])} tiles of the token, by its sort, and earns another
    10 tiles of range for every 10 levels of its task skill &mdash; ${Wr} &mdash; so a
    seasoned one works a wide stretch of country. Its card in the Wildermon window shows the range it
    has now and how much skill the next step needs.</p>
    <p>A tamed wildermon either <b>travels with you</b> (one at a time; its stance is Passive, Defensive
    or Aggressive), is <b>assigned to your deed</b>, where a Rabba forages around the settlement and
    drops what it finds in the settlement's storage, or is shut in a <b>creature crate</b>. Feed them
    from your pack; deed workers help themselves from storage.
    The <b>Wildermon</b> window (<kbd>P</kbd>) shows the condition, level and skills of every creature
    you own; wild ones keep theirs to themselves. Deed workers learn from their work, gaining skill at
    half a player's pace and working at half a player's speed, and better skill means better quality
    finds and quicker work.</p>
    <p><b>Creature crates.</b> A creature crate holds <b>one</b> wildermon. A fine carpenter builds it
    with a mallet from ${e}; it weighs <b>${g(dn).weight} kg</b> and does not rot.
    The first wildermon you tame follows you; <b>every one after that goes into an empty crate in your
    pack</b>, and without one you cannot tame it. A catch taken out of a trap is the same. Put the one
    following you, or a deed worker, into an empty crate you carry from its menu. Set a crate down on
    any spot of a tile and the wildermon is drawn inside it with its name over it. Open a crate
    &mdash; standing beside it, or from your pack &mdash; to <b>let it out to follow you</b>, when the
    one following you goes into the crate in its place, or to <b>set it to work the deed</b>, which
    takes one of its working slots. A wildermon in a crate does not get hungry. A young one born while
    something follows you goes into a crate too: see breeding. A crate with a
    wildermon in it can be carried, set down or opened, and <b>nothing else</b>: it cannot be dropped,
    bagged, stored, sold, posted or traded. <b>Take with you</b> on a deed worker, with a companion
    already following you, leaves that companion on the deed in its place, or puts it in an empty
    crate you carry when the deed has no room for it.</p>
    <p>Every tile is a 4 by 4 grid of spots for placing things. Build a <b>log crate</b> from
    ${P(`make_log_crate`)} &mdash; notched and lashed, not a nail in it &mdash; or a <b>plank crate</b> from
    ${P(`make_plank_crate`)} (with a mallet), then right-click the spot on a tile
    where you want it; it snaps to the grid. They hold ${Pn.log.capacity} and ${Pn.plank.capacity} things, can be opened, emptied and
    picked up again when empty. The deed crate beside the token is one of them.</p>
    <p><b>Where a worker puts things.</b> A deed worker fills the deed crate first, and when that is
    full it walks to the nearest other thing on the deed that will take what it is carrying &mdash;
    another crate, a raw material bin, a chest, a larder, a cart. A <b>trash crate</b> is never chosen, so
    nothing anybody worked for ends up in it. When <b>everything on the deed is full</b> the worker
    keeps hold of its load and stands about near the token rather than tipping it on the ground, and
    says so once: empty something or build more storage and it picks up where it left off. Seed for
    sowing and wood for stoking come out of any store on the deed, not only the deed crate.</p>
    <p><b>Moving things by hand.</b> Anything in the inventory or in an open container can be
    <b>dragged</b> from one window to the other. The rules are the same as the menu's: you have to be
    standing next to the container, and it has to be willing to hold what you are giving it &mdash; a
    raw material bin takes nothing worked, a craft material bin takes nothing unworked, a larder takes
    food, drink and flour, a seed bin takes seed only, a sprout bin takes sprouts only, a barrel takes no
    solids, a full crate is full. It says which when
    it will not go.</p>
    <p>Ground does not advertise what it is holding. Grass is grass to look at, wherever it stands in
    its cycle &mdash; click a tile, or press <b>T</b>, and the Tile window says whether there is
    <b>something to pick</b> or <b>something to gather</b> on it. Pick it over and the line goes;
    leave it a while and it comes back. Every ground that grows anything can hold something &mdash;
    grass, steppe, tundra, moss, marsh and lawn &mdash; and sand, dirt and clay never do, having
    nothing to give.</p>
    <p><b>A practised eye goes over the same ground more than once.</b> Foraging and botanizing take
    <b>one more pass over the tile for every ${p(20)} points</b> of the skill: ${Gr}.
    Each pass is its own chance of a find and its own roll on the table, so a good forager comes off one
    tile with an armful where a beginner comes off it with a berry &mdash; and the menu says how many
    passes you are good for before you start. The tile is still picked clean for the same while
    afterwards, so every pass is a tile you did not have to walk to.</p>
    <h3>Meditation, and the three paths</h3>
    <p>Sitting still on a rug thinking about nothing is not obviously work, and it is the slowest thing
    anybody does here. Make a <b>rug</b> (${P(`make_rug`)}, with a needle), stand where you mean to
    sit, and choose <b>Sit and think about nothing</b>. You may sit once every ${m(Nt)}, and
    <b>where</b> you sit decides what it is worth: your own yard ${v(Ke.yard)} of a sitting anywhere else,
    high ground off your settlement ${s(Ke.high)} as much, and where the ground runs out and the air is thin
    <b>${s(Ke.thin)}</b> as much; and your feet in the water add ${v(Ke.water-1)} to wherever that is.</p>
    <p>At ${p(5)} meditation ${p(M.length)} ways of looking at the island become clear and you may walk exactly
    <b>one</b>, chosen at the rug and never changed. Each opens ${p(M[0].steps.length)} things as the sitting goes on:
    ${p(M[0].steps.filter(e=>e.ability).length)} of them are abilities you call on with a rest between, and ${p(M[0].steps.filter(e=>!e.ability).length)} are simply true from then on.</p>
    <table>
      ${M.map(e=>`<tr><td><b>${e.name}</b></td><td>${e.note} ${e.steps.map(e=>e.ability?`<b>${e.name}</b> (${e.at}, then ${m(e.ability.rest)} before it again): ${Kr(e.note)}`:`<i>${e.name}</i> (${e.at}): ${Kr(e.note)}`).join(` `)}</td></tr>`).join(`
      `)}
    </table>
    <h3>An altar, and what kneeling at one buys</h3>
    <p>There is no god on this island with a name and nobody here would claim to know one. There is a
    stone table, there are the hours the clock favours, and there is the plain fact that a thing knelt
    over then comes out better than a thing that was not.</p>
    <p>An <b>altar</b> is masonry: ${P(`make_altar`)}, laid with a trowel. It is built, and set down, only on a
    settlement of yours: one you founded or one you are a citizen of. A settlement has one altar: a second
    is neither built nor set down on one that has its altar standing. Kneel at it and you bank
    <b>favour</b>, on the <b>prayer</b> skill. You may say what you have to say once every ${m(xt)}, and it is
    worth most at <b>${c(vt.map(yr))}</b> &mdash; ${s((xn+ht)/xn)} what it is worth
    ${p(3)} hours or more from either &mdash; and less the further off you are. A good altar banks more
    than a rough one. Favour also trickles back on its own, slowly, up to whatever your faith carries
    &mdash; ${Math.round(Ye(U(Le)))} at the start and 120 at the very top.</p>
    <p>It also holds the settlement's bauble sockets: see <b>Baubles</b>, under digging up the past.</p>
    <p><b>Sacrifice</b>, on the altar's menu, gives up one ${l.slice(1,-1).map(e=>e.name).join(`, `)} or ${l[l.length-1].name} thing from your
    pack, one of a stack where it is a stack, and fills ${c(Rt.map(e=>dt[e].toLowerCase()))} to the top.
    ${f(v(hr))} of sacrifices also leave a <b>mote</b> of the rarity of what was given up. Absorb a mote
    (<b>Absorb into</b>, on the mote) into an ordinary thing in your pack and that thing, or one of it where it is a stack,
    takes the mote's rarity. A locked thing, a worn one, a bag with anything in it and a crate with a wildermon in it
    are not given up, and a bauble takes no mote: its rarity is rolled when it is restored.</p>
    <p>${u(wn.length)} things it buys, and none of them can be had any other way:</p>
    <table>
      ${wn.map(e=>`<tr><td><b>${e.name}</b></td><td>${e.cost} favour, prayer ${e.level}. ${e.note}</td></tr>`).join(`
      `)}
    </table>
    <h3>The things that are not wildermon</h3>
    <p>Most of what walks this island can be tamed. ${u(qr.length)} things cannot. A <b>goblin</b> is knee-high and
    entirely malice; an <b>orc</b> is a head taller than you and carries sharpened iron; an <b>ogre</b>
    is mostly shoulder; and somewhere out there is the <b>dragon</b>.
    They notice you from ${p(Jr[0])} to ${p(Jr[Jr.length-1])} tiles off, where anything else that hunts has your scent at
    ${p(7)}; they come straight at you, and they do not give up easily.</p>
    <p>They are <b>rare</b>: ${v(Fn)} of what stands up out in the country, and of those
    ${c(y.map(([e,t])=>`${v(t/Yr)} ${O[e].name.toLowerCase()}s`))}. Only so many of each are alive at once
    (${c(y.map(([e])=>`${p(ln[e]??1)} ${O[e].name.toLowerCase()}${(ln[e]??1)===1?``:`s`}`))}), and the bigger the thing the further it keeps
    from your token &mdash; ${c(y.map(([e])=>`${d(O[e].name)} ${O[e].name.toLowerCase()} ${p(Xn[e]??0)} tiles`))}. None of them can be tamed,
    trapped, bred or brushed. There is nothing to be done with one but kill it, and nothing to be gained
    by meeting one in your shirt: ${c(y.map(([e],t)=>`${d(O[e].name)} ${O[e].name.toLowerCase()}'s ${t===0?`blow takes `:``}${v(Math.round(O[e].attack*Ze*100)/100)}`))} of an unarmoured life.</p>
    <p>What they are worth is on the other side of that. Butchering one gives what a wildermon gives and
    then some: <b>tusk</b> and <b>sinew</b> off an orc or an ogre, and off a dragon ${p(O.dragon.butcher.scale??0)}
    <b>dragon scales</b> and a <b>hoard</b> &mdash; ${p(4)} to ${p(10)} lumps, by how much of the carcass you keep,
    of the ${p(Xr.length)} deep metals and the ${p(ye.length-Xr.length)} precious ones, which is the only place on the
    island they turn up together.</p>
    <p>Tusk and sinew make a <b>composite bow</b>: ${P(`make_composite_bow`)}, at ${_r(`make_composite_bow`)}. It
    throws an arrow <b>${p(Zr.range??0)}</b> tiles for ${Zr.damage} damage, where the best wooden bow throws
    ${p(Qr.range??0)} for ${Qr.damage}. Dragon scale riveted to leather makes <b>scale armour</b>, a class above
    plate: it turns <b>${v(k.scale.soak)}</b> of a blow where plate turns ${v(k.plate.soak)}, and it burdens you
    less than chain. A full suit takes ${p($r)} scales, where one dragon carries ${p(O.dragon.butcher.scale??0)}.</p>
    <h3>Traps</h3>
    <p>Everything taken so far has been taken by hand: you stand in front of a wild thing with a berry
    out and hope. A <b>trap</b> is the other way. Set it, bait it, walk away, and whatever came to the
    bait while you were somewhere else is waiting when you come back &mdash; <b>alive</b>, and with
    whatever blood it was born with still in it, which is the point now that blood is worth something.</p>
    <p>A <b>snare</b> is a noose of rope on a bent shaft: ${ae(A.snare.bill)}, and it holds anything
    up to about <b>taming ${A.snare.holds}</b>. A <b>deadfall</b> is a weighted board on a trigger &mdash;
    ${ae(A.deadfall.bill)}, with a mallet &mdash; and it holds to about <b>taming ${A.deadfall.holds}</b>.
    Build quality moves both a little. Set one on any spot of a tile <b>outside your own
    borders</b> (nothing wild comes inside them), then <b>bait it</b> from your pack: the menu says
    which sorts would come to each thing you are carrying. Anything warier than the trap will hold
    simply takes the bait and goes.</p>
    <p>A trap rots where it stands, ${m(A.snare.lifeMin)} to ${m(A.snare.lifeMax)} for a snare and up to
    ${m(A.deadfall.lifeMax)} for a good deadfall, and whatever is in it walks away when it goes over. A <b>timid</b>
    creature &mdash; the very thing you cannot walk up to &mdash; is ${s(Mn)} as likely to walk into
    one, and a hunter ${v(Jn)} as likely. Getting the catch out is still <b>taming</b>: the skill wall stands
    whether the animal is held or not, and a beast that thrashes has to be tried again.</p>
    <h3>Blood, the brush and breeding</h3>
    <p>Every wildermon is born <b>male</b> or <b>female</b> and carries <b>${p(3)} traits</b>, and the
    traits are the whole difference between one Roxxen and the next. A trait sits in one of ${p(D.length)} tiers
    &mdash; ${c(D.map(e=>`<b>${e}</b>`))} &mdash; and what it is worth
    climbs steeply with the tier: a common trait moves its number by ${v(ei.common[0])} to ${v(ei.common[1])},
    a fantastic one by ${v(ei.fantastic[0])} to ${v(ei.fantastic[1])}. Traits lift how fast it <b>moves</b>, how quickly it <b>works</b>, how fast what it does
    goes into it as <b>skill</b>, what it can <b>carry and pull</b>, what it <b>brings back</b>, how
    little it <b>eats</b>, how much it can <b>take</b>, how hard it <b>hits</b>, how far it
    <b>sees</b>, how far it will <b>range</b>, how fast <b>fleece and milk</b> come back on it &mdash; and in a
    fight, what a blow <b>costs</b> it, how often a swing at it <b>lands</b>, how quickly its own <b>blows</b>
    come and how fast its wounds <b>close</b>.</p>
    <p>A few traits are <b>communal</b> (marked &#9673;): what they lift, they lift for every wildermon
    working the same settlement or the same post, the bearer included. One <i>pack leader</i> standing
    in the field makes a whole deed quicker and brighter.</p>
    <p>${u(ut.length)} of the traits are <b>fighting blood</b> &mdash; fanged, plated, slippery, quick-jawed,
    quick-healing and the rest &mdash; and those come in every tier under the one name. When one rolls,
    its <b>grade</b> is a roll of its own off the same odds, so a fanged animal may be fanged, fanged
    (rare), fanged (supreme) or fanged (fantastic), each worth steeply more than the last &mdash; ${c(D.map(e=>s(ot[e])).slice(1))} what
    the common grade is &mdash; and a line is bred up a grade at a time under the same husbandry.
    ${f(v(Vn))} of what the wild throws up is fighting blood, and no animal carries more than one grade of a name.</p>
    <p>What is walking about in the wild is almost all common. Better blood is <b>bred</b>, and that is
    what <b>animal husbandry</b> is for. Make a <b>brush</b> (${P(`make_brush`)}, with a carving
    knife) and <b>brush a wildermon down</b>: it puts <b>care</b> into the animal, and a cared-for beast
    works quicker, learns faster and heals as you go over it. Care runs out again over ${m(3*vr)}
    of being left alone, so it is a thing you keep up rather than do once.</p>
    <p>To breed, stand a <b>male</b> and a <b>female</b> of one sort within ${p(4)} tiles of each other,
    both <b>grown</b>, both <b>fed</b>, and neither put to a mate in the last ${m(lt)}, then
    choose <b>Put it to a mate</b>. The young one goes where a tamed one goes: it <b>follows you</b> when
    nothing else does, and goes into an <b>empty creature crate in your pack</b> when something does. Carrying
    none, it goes into an <b>empty creature crate of yours standing on your settlement</b>, the nearest the
    mother; and with none of those it goes off into the wild. If it takes,
    the female carries for ${m(Kt)} and then drops a young one, and what it is born with was
    settled at that moment &mdash; a sire sold, released or eaten in between has already had his say.</p>
    <p>${f(p(3))} slots are filled one at a time. Each is drawn from what the pair carry between them, and
    husbandry decides <b>how often the parents' blood comes through</b> rather than whatever the wild throws up
    (${t(Tt(0,0))} at no skill, ${v(Tt(W,1))} at ${p(W)} with a well-brushed pair), and <b>how often a
    trait comes through one tier better than either parent had it</b> (never at no skill and with no care,
    ${v(Fe(W,1))} at ${p(W)} with a well-brushed pair) &mdash; commons becoming rares, rares becoming supremes.
    That second chance is the whole of why husbandry is worth having: it is how a line climbs. A
    high-husbandry eye also falls on the best of what the pair carry rather than picking evenly.</p>
    <p>You cannot read what you do not know. <b>Look it over</b> names the traits your husbandry is good
    enough to recognise: common blood is plain to anybody, ${c(D.slice(1).map((e,t)=>`${e} ${t===0?`takes `:``}${On[e]+1}`))}
    to know when it is standing in front of you. Until then the card shows only that there is
    <i>something</i> there. Only a <b>female</b> is in milk, and nothing young or past it will breed.</p>
    <p>A young one's <b>pedigree</b> names its <b>dam</b> and <b>sire</b> on its card in the Wildermon
    window and when you point at it, and on the card each of its traits you can read says where it came
    from &mdash; ${o}.</p>
    <h3>Terraforming</h3>
    <p>Every corner of the map has soil sitting on bedrock. <b>Digging</b> lowers the corner nearest to
    where you click (the small marker) and takes a spadeful of that soil; when the last of it is gone
    your shovel grates on rock and will go no further. Strip every corner of a tile bare and the
    rock beneath is exposed, and the tile becomes rock &mdash; whatever kind lies there, which may be a
    seam of silver or gold. Drop dirt on a corner to bury the rock again.</p>
    <p><b>The level.</b> Right-click a corner and choose <b>Take the level here</b> and that corner's
    height becomes the mark every job works to. <b>Flatten</b> aims at it instead of at the tile you
    are standing on, so a whole yard can be brought to one height from wherever you happen to stand.
    <b>Digging</b> and <b>Chip corner</b> refuse a corner once it is down to the mark, and <b>dropping
    dirt</b> and <b>concrete</b> refuse one once it is up to it &mdash; so a long run of spadefuls
    asked for at a bank stops the moment the bank is level, rather than when the run is done.
    The Tile window says how far the corner under the cursor stands from the mark. <b>Clear the
    level</b> puts it away.</p>
    <p><b>A spadeful out of the cart.</b> Dirt, clay and sand weigh <b>${g(`dirt`).weight}kg</b> apiece, so a starting
    back carries ${p(Math.floor(220/g(`dirt`).weight))} before it starts to drag, and moving a bank is a great many walks. Dropping dirt and the packing-in half
    of flattening will take a spadeful out of any <b>crate, cart or bin within reach</b> when you are
    carrying none yourself: park the cart where the work is and it feeds itself.</p>
    <p><b>Beds of sand, clay, peat and tar</b> are not dug like that unless you want them dug. Stand on
    one and choose <b>Collect</b> &mdash; the entry names what is underfoot, <i>Collect clay</i>,
    <i>Collect tar</i> &mdash; and you fill a shovel off the top of it: the tile keeps its type, its
    corners keep their height and their soil, and the bed is there the next time you come back. It takes
    a moment longer than cutting a corner away, which is the whole of the difference. Digging the corner
    still does what it always did, for when you actually want the ground lower.</p>
    <p><b>Packing</b> is what makes a floor of the ground. A shovel treads <b>grass, dirt, lawn, steppe,
    tundra or moss</b> down into <b>packed dirt</b>: on sod it cuts the turf away first. Packed dirt is
    what a building wants under it, and it is the only thing <b>paving</b> will go on &mdash; both
    cobblestone and slabs want a hard, flat bed, and will not be laid on loose earth or on grass.
    Breaking paving up with a pickaxe leaves bare dirt, so repaving means packing it again.</p>
    <p>${u(q.length)} kinds of seam lie in the rock, and each needs a certain <b>mining</b> skill before it can be
    worked at all: ${c(q.filter(e=>e.level===q[0].level).map(e=>ti(e.name)))} from the very start, then
    ${c(q.filter(e=>e.level!==q[0].level).map(e=>`${ti(e.name)} at ${e.level}`))}. <b>Iron is
    ${v(kt(`iron_ore`))} of every seam on the island</b> and everything else shares what
    is left, which is why iron is the metal you build with and the rest are the ones you hoard. Coal burns longer than a log, so a campfire
    will take it gladly.</p>
    <p><b>Mining</b> with a pickaxe works bare rock for what is in it. Every swing that bites gives you
    shards or metal and leaves the face standing where it was; about <b>one swing in
    ${Math.round(1/Sn)}</b> a slab comes away of its own accord and the corner drops a
    step, whether the hand on the pick is yours or a mola's. If you want the rock <i>moved</i>, that
    is <b>Chip corner</b>: the same pick at the same corner, but you are cutting the face back rather
    than working it, and it gives way about one attempt in ${p(Math.round(1/Tn))}. What breaks away is yours either
    way.</p>
    <p>Every tile in the world sits on a particular rock of a particular quality &mdash; under grass,
    under a forest, under the sea, everywhere &mdash; settled when the world was made and unchanged by
    anything you do to the ground above it. Metal is laid far more thickly under dry land than under
    the sea, so most of what an island holds can actually be reached: about one land tile in
    ${p(Math.round(1/lr.land))} carries some seam, and one sea tile in ${p(Math.round(1/lr.water))}. <b>Prospecting</b> is how you read it. It marks every
    ore-bearing tile within range, buried or bare, and sampling where you stand names the rock, the
    mining skill any metal takes to work, the highest quality it will ever give up, and how deep it
    lies. The range starts at ${p(3)} tiles and grows by one for every ${p(10)} levels of the skill. Metal found
    under a meadow has to be dug down to before a pickaxe is any use.</p>
    <p><b>Flatten</b> brings a tile level with the ground you are standing on, corner by corner:
    ground above you is scraped down and pocketed as dirt, ground below you is packed up and spends
    dirt from your pack. Stand where you want the finished height and work outwards to terrace a
    hillside. Flattening the tile under your own feet has nothing to match, so it comes down to that
    tile's lowest corner instead.</p>
    <p>Dropped items lie where you stood; the tile's menu offers to pick them up again. Anything
    left outside slowly decays, even while you are away: food rots within the hour, stone lasts for
    days, and better quality holds up longer. Fill your water skin at any shore and drink from it on
    the road.</p>
    <p>Your skills rise with everything you do. Better skill means faster, more successful actions and
    the freedom to shape steeper slopes.</p>
    <p><b>What a gain is worth falls away as the skill fills.</b> An ordinary action gives about
    ${c(ni.map((e,t)=>`<b>${ii(e)}</b> at ${t===0?`level `:``}${e}`))} &mdash;
    ${p(Math.round(1/ri(ni[0])))} goes for the first point of a skill, ${p(Math.round(1/ri(ni[2])))} for the point after
    ${ni[2]}, and something like <b>${p(Math.round(1/de))}</b> for the last. Nobody finishes a skill in passing; the last
    point of one is a thing to go after on purpose, and the log shows it moving at the fourth place
    after the point while you do.</p>
  `}function qi(e){e.body.classList.add(`help-body`);let t=document.createElement(`div`);t.innerHTML=Ki();let n=[],r=null;for(let e of[...t.childNodes]){if(e instanceof HTMLHeadingElement&&e.tagName===`H3`){r=document.createElement(`section`),r.className=`help-sec`,r.id=`help-${n.length}`,r.append(e),n.push({title:e.textContent??``,el:r});continue}r?r.append(e):(e.nodeType!==Node.TEXT_NODE||(e.textContent??``).trim())&&t.removeChild(e)}let i=document.createElement(`input`);i.type=`search`,i.className=`panel-search help-search`,i.placeholder=`Search the help…`;let a=document.createElement(`nav`);a.className=`help-contents`;let o=document.createElement(`div`);o.className=`help-pages`;let s=document.createElement(`div`);s.className=`help-count`,s.hidden=!0;let ee=n.map(({title:e,el:t},r)=>{let a=document.createElement(`button`);return a.type=`button`,a.className=`help-link`,a.textContent=e,a.addEventListener(`click`,()=>{i.value&&(i.value=``,c(``)),t.scrollIntoView({block:`start`}),t.classList.add(`help-found`),setTimeout(()=>t.classList.remove(`help-found`),1200)}),a.title=`Jump to “${e}” (section ${r+1} of ${n.length})`,a});a.append(...ee);let c=e=>{let t=e.trim().toLowerCase(),r=0;for(let e=0;e<n.length;e+=1){let{title:i,el:a}=n[e],o=!t||`${i} ${a.textContent??``}`.toLowerCase().includes(t);a.hidden=!o,ee[e].hidden=!o,o&&(r+=1)}s.hidden=!t,s.textContent=r?`${r} of ${n.length} sections`:`Nothing in the help answers to “${e.trim()}”.`,o.scrollTop=0};i.addEventListener(`input`,()=>c(i.value)),i.addEventListener(`keydown`,e=>{e.stopPropagation(),e.key===`Escape`&&(i.value=``,c(``))}),o.append(...n.map(e=>e.el)),e.body.replaceChildren(i,a,s,o)}export{qi as buildHelp};