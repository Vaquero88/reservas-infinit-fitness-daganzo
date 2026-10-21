(() => {
  const TIMES = ['09:00 – 10:00', '18:00 – 18:30', '20:30 – 21:00'];
  const END_TIMES = ['10:00', '18:30', '21:00'];
  const MAX_CAPACITY = 6;
  const config = window.GYM_CONFIG || {};
  const ready = Boolean(window.supabase?.createClient && config.supabaseUrl && config.supabasePublishableKey && !config.supabaseUrl.includes('PEGA_AQUI') && !config.supabasePublishableKey.includes('PEGA_AQUI'));
  const db = ready ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selected = null, selectedSlot = null, counts = {}, availability = {}, trainerKey = '', trainerData = null, trainerView = 'roster', historyName = '', warningName = '';
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const classKey = (date, slot) => `${date}-${slot}`;
  const norm = s => String(s || '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validName = s => String(s || '').trim().split(/\s+/).filter(Boolean).length >= 3;
  function notify(message) { $('noticeText').textContent=message; $('notice').classList.add('show'); $('noticeClose').focus(); }
  function showMemberNotFound(name) {
    const subject=encodeURIComponent('Alta de socio o incidencia en reservas');
    const body=encodeURIComponent(`Hola, soy ${name}. No aparezco en la base de datos de reservas y quiero darme de alta o comunicar una incidencia.`);
    const email=`mailto:Fernando.daganzo@infinitfitness.com.es?subject=${subject}&body=${body}`;
    const whatsapp=`https://wa.me/34689625983?text=${body}`;
    $('noticeText').innerHTML=`No encontramos tu nombre en la base de datos de socios. Si crees que es un error o quieres darte de alta, contacta con Fernando: <a href="${email}">enviar correo</a> o <a href="${whatsapp}" target="_blank" rel="noopener">abrir WhatsApp</a>.`;
    $('notice').classList.add('show'); $('noticeClose').focus();
  }
  function updateRulesContactLinks() {
    const name=$('memberName').value.trim().replace(/\s+/g,' ');
    const subject=encodeURIComponent('Alta de socio o incidencia en reservas');
    const body=encodeURIComponent(name?`Hola, soy ${name}. No aparezco en la base de datos de reservas y quiero darme de alta o comunicar una incidencia.`:'Hola, no aparezco en la base de datos de reservas y quiero darme de alta o comunicar una incidencia.');
    $('rulesEmail').href=`mailto:Fernando.daganzo@infinitfitness.com.es?subject=${subject}&body=${body}`;
    $('rulesWhatsapp').href=`https://wa.me/34689625983?text=${body}`;
  }
  function closeNotice() { $('notice').classList.remove('show'); }
  function showDbError(error) { console.error(error); notify(error?.message || 'No se pudo conectar con las reservas.'); }
  function localDay(date) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
  function isBookable(date) { const today=localDay(new Date()), limit=new Date(today); limit.setDate(limit.getDate()+7); const day=localDay(date); return day>=today && day<=limit; }
  function classStart(date,slot) { const [h,m]=TIMES[slot].slice(0,5).split(':').map(Number); return new Date(date.getFullYear(),date.getMonth(),date.getDate(),h,m); }
  function classHasEnded(date,slot) {
    const nowParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const part=type=>nowParts.find(item=>item.type===type)?.value||'00';
    const madridNow=`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
    return `${dateKey(date)}T${END_TIMES[slot]}:00`<madridNow;
  }
  function madridTodayKey() {
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part=type=>parts.find(item=>item.type===type)?.value||'00';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function displayDate(date, options={weekday:'long',day:'numeric',month:'long'}) { const value=new Intl.DateTimeFormat('es-ES',options).format(date); return value.charAt(0).toUpperCase()+value.slice(1); }
  function fromIsoDate(value) { return new Date(`${value}T12:00:00`); }
  async function loadCounts() {
    if(!ready) return;
    const start=new Date(view.getFullYear(),view.getMonth(),1), end=new Date(view.getFullYear(),view.getMonth()+1,0);
    const {data,error}=await db.rpc('get_class_counts',{p_start_date:dateKey(start),p_end_date:dateKey(end)});
    if(error){showDbError(error);return;}
    counts={}; availability={}; (data||[]).forEach(row=>{const key=classKey(row.class_date,Number(row.class_slot));counts[key]=Number(row.remaining_places);availability[key]=Boolean(row.is_open);});
    renderCalendar(); if(selected) renderClasses(); syncReserveButton();
  }
  function renderCalendar() {
    const year=view.getFullYear(), month=view.getMonth();
    const title=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(view);
    $('monthTitle').textContent=title.charAt(0).toUpperCase()+title.slice(1);
    const offset=(new Date(year,month,1).getDay()+6)%7, total=new Date(year,month+1,0).getDate(); let html='';
    for(let i=0;i<offset;i++) html+='<div class="day blank"></div>';
    for(let d=1;d<=total;d++) {
      const date=new Date(year,month,d), weekend=[0,6].includes(date.getDay()), past=localDay(date)<localDay(new Date()), closed=!isBookable(date), today=dateKey(date)===dateKey(new Date()), active=selected&&dateKey(date)===dateKey(selected);
      let remainingClasses=0;
      if(!closed) TIMES.forEach((_,slot)=>{
        const hasStarted=classStart(date,slot)<=new Date(), remaining=counts[classKey(dateKey(date),slot)]??MAX_CAPACITY, open=availability[classKey(dateKey(date),slot)]??!weekend;
        if(open&&!hasStarted&&remaining>0)remainingClasses++;
      });
      const hasAvailability=!closed&&remainingClasses>0;
      const availabilityLabel=closed?'':`<span class="day-status ${hasAvailability?'available':'unavailable'}">${hasAvailability?'Clases disponibles':'No hay clases disponibles'}</span>`;
      html+=`<div class="day ${weekend?'weekend':''} ${past?'past':''} ${closed?'closed':''} ${today?'today':''} ${active?'selected':''} ${availabilityLabel?(hasAvailability?'availability-yes':'availability-no'):''}" data-day="${d}" title="${closed?'Reservas disponibles con hasta 7 días de antelación':''}" ${closed?'aria-disabled="true"':''}><span class="num">${d}</span>${availabilityLabel}</div>`;
    }
    $('days').innerHTML=html;
  }
  function renderClasses() {
    if(!selected){ $('chosenDate').textContent='Selecciona un día'; $('dayCaption').textContent='De lunes a viernes'; $('classlist').innerHTML=ready?'<div class="empty">Pulsa un día disponible del calendario para ver las clases.</div>':'<div class="empty">Conecta Supabase en <strong>config.js</strong> y aplica <strong>schema.sql</strong> para activar las reservas compartidas.</div>'; return; }
    $('chosenDate').textContent=displayDate(selected);
    $('dayCaption').textContent='Reserva con hasta 7 días de antelación';
    if(!ready){$('classlist').innerHTML='<div class="empty">Falta configurar la base de datos compartida.</div>';return;}
    const openSlots=TIMES.map((time,slot)=>({time,slot})).filter(({slot})=>availability[classKey(dateKey(selected),slot)]??(selected.getDay()>=1&&selected.getDay()<=5));
    if(!openSlots.length){$('classlist').innerHTML='<div class="empty">No hay clases abiertas este día.</div>';return;}
    $('classlist').innerHTML=openSlots.map(({time,slot})=>{
      const remaining=counts[classKey(dateKey(selected),slot)]??MAX_CAPACITY, past=classStart(selected,slot)<=new Date();
      const full=remaining<=0, low=remaining>0&&remaining<=2;
      return `<button class="slot ${selectedSlot===slot?'selected':''} ${past?'disabled':''} ${full?'full':''} ${low?'low':''}" data-slot="${slot}" ${past||full?'disabled':''}><span class="slotleft"><i class="timeicon">◷</i><span><strong>${time}</strong><small>${full?'Clase completa':'Entrenamiento en grupo'}</small></span></span><span class="occupancy"><b>${remaining}</b>${remaining===1?'plaza restante':'plazas restantes'}</span></button>`;
    }).join('');
    $('classlist').querySelectorAll('[data-slot]').forEach(button=>button.onclick=()=>{selectedSlot=Number(button.dataset.slot);renderClasses();syncReserveButton();});
  }
  function syncReserveButton() {
    const name=$('memberName').value.trim().replace(/\s+/g,' '), parts=name?name.split(' '):[];
    const full=Boolean(selected&&selectedSlot!==null&&(counts[classKey(dateKey(selected),selectedSlot)]??MAX_CAPACITY)<=0);
    const reasons=[];
    if(!ready) reasons.push('Las reservas no están disponibles ahora mismo.');
    else {
      if(parts.length===0) reasons.push('Escribe tu nombre y tus dos apellidos.');
      else if(parts.length===1) reasons.push('Añade tus dos apellidos.');
      else if(parts.length===2) reasons.push('Te falta el segundo apellido.');
      if(!selected||selectedSlot===null) reasons.push('Selecciona una clase.');
      if(full) reasons.push('Esta clase está completa; elige otra.');
    }
    const help=$('bookingHelp'); help.textContent=reasons.join(' '); help.hidden=reasons.length===0;
    $('reserve').disabled=!ready||selectedSlot===null||!selected||parts.length<3||full;
  }
  function render() { renderCalendar(); renderClasses(); syncReserveButton(); }
  function openBookingConfirmation(date,slot) {
    $('confirmationTime').textContent=TIMES[slot];
    $('confirmationDate').textContent=displayDate(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    $('bookingConfirmation').classList.add('show'); $('closeBookingConfirmation').focus();
  }
  function closeBookingConfirmation() { $('bookingConfirmation').classList.remove('show'); }
  function setTrainerPanel(authorized) { $('trainerLogin').hidden=authorized; $('trainerPanel').hidden=!authorized; if(!authorized){trainerKey='';trainerData=null;historyName='';warningName='';$('roster').innerHTML='';$('pastRoster').innerHTML='';$('historyMembers').innerHTML='';$('historyView').innerHTML='';$('warningMembers').innerHTML='';$('warningSessions').innerHTML='';} }
  async function fetchTrainerData() {
    const {data,error}=await db.rpc('trainer_data',{p_key:trainerKey}); if(error) throw error;
    trainerData=data||{bookings:[],events:[]}; return trainerData;
  }
  function currentAbsence(booking) {
    const actions=(trainerData?.events||[]).filter(e=>e.booking_id===booking.id&&(e.event_type==='absence'||e.event_type==='absence_reversed')).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    return actions.length>0&&actions[actions.length-1].event_type==='absence';
  }
  function renderBookingList(container,items,emptyMessage,allowCancel) {
    if(!items.length){$(container).innerHTML=`<div class="empty">${emptyMessage}</div>`;return;}
    const canManageBookings=allowCancel&&trainerData?.is_owner===true; let html=''; let last='';
    items.forEach(booking=>{
      const d=fromIsoDate(booking.class_date), slot=Number(booking.class_slot), group=`${booking.class_date}-${slot}`;
      if(group!==last){html+=`<div class="rosterclass">${escapeHtml(displayDate(d))} · ${TIMES[slot]}</div>`;last=group;}
      const ended=classHasEnded(d,slot), absent=currentAbsence(booking);
      const control=absent?'<button class="markabsence" data-action="undo" type="button">Anular warning</button>':ended?'<span class="status">Clase finalizada</span>':'<span class="status">Pendiente</span>';
      const adminCancel=canManageBookings?'<button class="markabsence" data-action="cancel-booking" type="button">Cancelar reserva</button>':'';
      html+=`<div class="rosterperson" data-booking="${escapeHtml(booking.id)}"><span>${escapeHtml(booking.member_name)}<small>${ended?'Clase finalizada':'Clase pendiente'}</small></span>${absent?'<span class="status absent">Warning registrado</span>':''}<span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${adminCancel}${control}</span></div>`;
    });
    $(container).innerHTML=html;
  }
  function renderRoster() {
    const bookings=[...(trainerData?.bookings||[])].sort((a,b)=>`${a.class_date}-${a.class_slot}`.localeCompare(`${b.class_date}-${b.class_slot}`));
    const pending=bookings.filter(b=>!classHasEnded(fromIsoDate(b.class_date),Number(b.class_slot)));
    renderBookingList('roster',pending,'No hay reservas pendientes.',true);
  }
  function renderOwnerRoster(viewName) {
    const todayKey=madridTodayKey();
    const bookings=[...(trainerData?.bookings||[])].sort((a,b)=>`${a.class_date}-${a.class_slot}`.localeCompare(`${b.class_date}-${b.class_slot}`));
    const visible=viewName==='today'
      ?bookings.filter(b=>b.class_date===todayKey)
      :bookings.filter(b=>b.class_date>=todayKey&&!classHasEnded(fromIsoDate(b.class_date),Number(b.class_slot)));
    renderBookingList('roster',visible,viewName==='today'?'No hay reservas para hoy.':'No hay reservas futuras.',true);
  }
  function renderPastRoster() {
    const bookings=[...(trainerData?.bookings||[])].sort((a,b)=>`${b.class_date}-${b.class_slot}`.localeCompare(`${a.class_date}-${a.class_slot}`));
    const past=bookings.filter(b=>classHasEnded(fromIsoDate(b.class_date),Number(b.class_slot)));
    renderBookingList('pastRoster',past,'Todavía no hay reservas pasadas.',false);
  }
  function trainerMemberNames() {
    const names=new Map();
    (trainerData?.members||[]).forEach(m=>{if(!names.has(norm(m.member_name)))names.set(norm(m.member_name),m.member_name)});
    (trainerData?.bookings||[]).forEach(b=>{if(!names.has(norm(b.member_name)))names.set(norm(b.member_name),b.member_name)});
    (trainerData?.events||[]).forEach(e=>{if(!names.has(norm(e.member_name)))names.set(norm(e.member_name),e.member_name)});
    return [...names.values()].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
  }
  function renderWarnings() {
    const names=trainerMemberNames();
    $('warningMembers').innerHTML=`<h3>Selecciona un socio</h3><p class="member-add-copy">Elige un socio para consultar sus reservas de los últimos 7 días.</p>${names.length?'<div class="member-list">'+names.map(name=>`<div class="member-row"><button class="member-choice ${warningName&&norm(warningName)===norm(name)?'active':''}" type="button" data-warning-member="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><span class="member-expand">${warningName&&norm(warningName)===norm(name)?'Seleccionado':'Ver sesiones'}</span></button></div>`).join('')+'</div>':'<div class="empty">No hay socios dados de alta.</div>'}`;
    renderWarningSessions();
  }
  function renderWarningSessions() {
    const panel=$('warningSessions');
    if(!warningName){panel.innerHTML='<div class="empty">Selecciona un socio para ver sus sesiones reservadas.</div>';return;}
    const todayKey=madridTodayKey(),firstDate=new Date(`${todayKey}T12:00:00Z`);firstDate.setUTCDate(firstDate.getUTCDate()-6);const firstDateKey=firstDate.toISOString().slice(0,10);
    const sessions=(trainerData?.bookings||[]).filter(b=>norm(b.member_name)===norm(warningName)).filter(b=>b.class_date>=firstDateKey&&b.class_date<=todayKey).sort((a,b)=>`${b.class_date}-${b.class_slot}`.localeCompare(`${a.class_date}-${a.class_slot}`));
    if(!sessions.length){panel.innerHTML=`<h3>Sesiones de ${escapeHtml(warningName)}</h3><div class="empty">No tiene sesiones reservadas en los últimos 7 días.</div>`;return;}
    panel.innerHTML=`<h3>Sesiones reservadas por ${escapeHtml(warningName)} · últimos 7 días</h3>`+sessions.map(booking=>{
      const day=fromIsoDate(booking.class_date),slot=Number(booking.class_slot),ended=classHasEnded(day,slot),warned=currentAbsence(booking);
      const action=warned?'undo':'mark';
      const label=warned?'Anular warning':'Registrar warning';
      return `<div class="rosterperson warning-session"><span>${escapeHtml(displayDate(day))} · ${TIMES[slot]}<small>${warned?'Warning registrado':ended?'Clase finalizada':'La hora de finalización se comprobará al registrar'}</small></span><button class="markabsence ${warned?'warning-undo':''}" type="button" data-warning-action="${action}" data-warning-booking="${escapeHtml(booking.id)}">${label}</button></div>`;
    }).join('');
  }
  function renderMembers() {
    const names=new Map(); (trainerData?.members||[]).forEach(m=>{if(!names.has(norm(m.member_name)))names.set(norm(m.member_name),m.member_name)}); (trainerData?.bookings||[]).forEach(b=>{if(!names.has(norm(b.member_name)))names.set(norm(b.member_name),b.member_name)}); (trainerData?.events||[]).forEach(e=>{if(!names.has(norm(e.member_name)))names.set(norm(e.member_name),e.member_name)});
    const list=[...names.values()].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    const owner=trainerData?.is_owner===true;
    $('historyMembers').innerHTML=`<h3>Socios</h3>${owner?'<button class="markabsence clear-history clear-history-all" type="button" data-clear-all-history>Borrar todos los historiales</button>':''}${list.length?'<div class="member-list">'+list.map(name=>{const active=historyName&&norm(historyName)===norm(name);return `<div class="member-row"><button class="member-choice ${active?'active':''}" type="button" data-member="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><span class="member-expand">${active?'Cerrar historial':'Ver historial'}</span></button>${active?`<div class="member-history-inline">${renderMemberHistory(name)}</div>`:''}</div>`}).join('')+'</div>':'<div class="empty">Todavía no hay socios en el historial.</div>'}`;
    $('historyView').innerHTML='';
  }
  function renderMemberHistory(name) {
    const events=(trainerData?.events||[]).filter(e=>norm(e.member_name)===norm(name)).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    const counts={reservation:0,cancellation:0,warning:0}, absenceState={};
    events.forEach(e=>{if(e.event_type==='reservation')counts.reservation++;if(e.event_type==='cancellation')counts.cancellation++;});
    const resetAt=(trainerData?.warning_resets||[]).filter(r=>norm(r.member_name)===norm(name)).map(r=>r.reset_at).sort().at(-1);
    const warningWindowStart=Date.now()-14*24*60*60*1000;
    events.filter(e=>(e.event_type==='absence'||e.event_type==='absence_reversed')&&new Date(e.created_at).getTime()>=warningWindowStart&&(!resetAt||e.created_at>resetAt)).forEach(e=>{absenceState[e.booking_id||`${e.class_date}-${e.class_slot}`]=e.event_type==='absence';});
    counts.warning=Object.values(absenceState).filter(Boolean).length;
    const log=events.map(e=>{
      const labels={reservation:e.created_by?'Reserva añadida por entrenador':'Reservó',cancellation:e.late?'Canceló con menos de dos horas de antelación':'Canceló',absence:'WARNING · No asistió a la clase',absence_reversed:'Warning anulado por entrenador'};
      const addedBy=e.event_type==='reservation'&&e.created_by?` · Añadida por: ${escapeHtml(e.created_by)}`:'';
      return `<div class="historyevent ${e.event_type==='absence'?'warning-event':''}">${labels[e.event_type]||escapeHtml(e.event_type)}<small>${escapeHtml(displayDate(fromIsoDate(e.class_date)))} · ${TIMES[Number(e.class_slot)]} · Registro: ${escapeHtml(new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(e.created_at)))}${addedBy}</small></div>`;
    }).join('');
    const deleteButtons=trainerData?.is_owner===true?'<div class="history-actions"><button class="markabsence clear-history" type="button" data-clear-member-history>Borrar historial del socio</button><button class="markabsence delete-member" type="button" data-delete-member-history>Borrar socio y su historial</button></div>':'';
    return `<h3>Historial de ${escapeHtml(name)}</h3>${deleteButtons}<div class="historysummary">Reservas: <strong>${counts.reservation}</strong> · Cancelaciones: <strong>${counts.cancellation}</strong> · Warnings actuales: <strong class="warning-count">${counts.warning}</strong></div>${log||'<div class="empty">No hay movimientos registrados para este socio.</div>'}`;
  }
  function renderAddBooking() {
    const members=[...(trainerData?.members||[])].map(m=>m.member_name).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    $('trainerBookingPanel').querySelector('.empty')?.remove();
    $('trainerBookingMember').innerHTML='<option value="">Selecciona un socio</option>'+members.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if(!members.length)$('trainerBookingPanel').insertAdjacentHTML('beforeend','<div class="empty">No hay socios dados de alta.</div>');
  }
  function renderTrainerView() {
    const isOwner=trainerData?.is_owner===true;
    $('ownerTrainerNav').hidden=!isOwner; $('regularTrainerNav').hidden=isOwner;
    document.querySelectorAll('#ownerTrainerNav [data-trainer-view],#regularTrainerNav [data-trainer-view]').forEach(button=>{
      const active=button.dataset.trainerView===trainerView;
      button.classList.toggle('active-trainer-tab',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    });
    $('showAddMemberOwner').classList.toggle('active-trainer-tab',trainerView==='addMember');
    $('showScheduleOwner').classList.toggle('active-trainer-tab',trainerView==='schedule');
    $('roster').hidden=!['roster','today','future'].includes(trainerView); $('pastRoster').hidden=trainerView!=='pastRoster'; $('historyMembers').hidden=trainerView!=='history'; $('historyView').hidden=true; $('memberAddPanel').hidden=trainerView!=='addMember'||!isOwner; $('trainerBookingPanel').hidden=trainerView!=='addBooking'; $('schedulePanel').hidden=trainerView!=='schedule'||!isOwner; $('warningMembers').hidden=trainerView!=='warnings'; $('warningSessions').hidden=trainerView!=='warnings';
    if(trainerView==='roster')renderRoster(); if(trainerView==='today'||trainerView==='future')renderOwnerRoster(trainerView); if(trainerView==='pastRoster')renderPastRoster(); if(trainerView==='history')renderMembers(); if(trainerView==='warnings')renderWarnings(); if(trainerView==='addBooking')renderAddBooking();
  }
  async function changeTrainerView(name) {
    if(!trainerKey)return; trainerView=name;
    try{await fetchTrainerData();renderTrainerView();}catch(error){showDbError(error);}
  }
  $('prev').onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()-1,1);render();loadCounts();};
  $('next').onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()+1,1);render();loadCounts();};
  $('days').onclick=e=>{const el=e.target.closest('[data-day]');if(!el)return;const d=new Date(view.getFullYear(),view.getMonth(),Number(el.dataset.day));if(!isBookable(d))return;selected=d;selectedSlot=null;renderCalendar();renderClasses();syncReserveButton();};
  $('memberName').oninput=()=>{updateRulesContactLinks();syncReserveButton();};
  $('reserve').onclick=async()=>{
    if(!ready||selectedSlot===null||!selected)return;
    if(!validName($('memberName').value)){notify('Escribe tu nombre y tus dos apellidos.');return;}
    if(!isBookable(selected)){notify('Solo se puede reservar con hasta 7 días de antelación.');return;}
    if((counts[classKey(dateKey(selected),selectedSlot)]??MAX_CAPACITY)<=0){notify('Esta clase ya ha alcanzado el máximo de 6 personas.');await loadCounts();return;}
    const bookedDate=new Date(selected.getFullYear(),selected.getMonth(),selected.getDate()), bookedSlot=selectedSlot;
    const name=$('memberName').value.trim().replace(/\s+/g,' '); $('reserve').disabled=true;
    const {error}=await db.rpc('reserve_class',{p_class_date:dateKey(selected),p_slot:selectedSlot,p_member_name:name});
    if(error){const message=String(error.message||'');if(message.includes('SOCIO_NO_ENCONTRADO'))showMemberNotFound(name);else if(message.includes('SOCIO_BLOQUEADO'))notify(message.replace('SOCIO_BLOQUEADO:','').trim());else showDbError(error);await loadCounts();return;}
    selectedSlot=null;await loadCounts();render();openBookingConfirmation(bookedDate,bookedSlot);
  };
  async function loadMyBookings() {
    if(!ready){notify('Falta conectar la base de datos compartida.');return;}
    const name=$('memberName').value.trim().replace(/\s+/g,' ');
    if(!validName(name)){notify('Escribe tu nombre y tus dos apellidos tal como los usaste al reservar.');return;}
    const box=$('myBookings'); box.innerHTML='<div class="empty">Buscando tus reservas…</div>';
    const {data,error}=await db.rpc('my_confirmed_bookings',{p_member_name:name});
    if(error){box.innerHTML='';if(error.code==='PGRST202'||String(error.message||'').includes('my_confirmed_bookings'))notify('Falta actualizar Supabase: ejecuta el schema.sql actualizado en SQL Editor.');else showDbError(error);return;}
    const bookings=(data||[]).filter(b=>!classHasEnded(fromIsoDate(b.class_date),Number(b.class_slot)));
    if(!bookings.length){box.innerHTML='<div class="empty">No tienes reservas pendientes. Las clases que ya han terminado no aparecen aquí.</div>';return;}
    box.innerHTML='<div class="rosterclass">Tus reservas confirmadas</div>'+bookings.map(b=>`<div class="my-booking" data-date="${escapeHtml(b.class_date)}" data-slot="${Number(b.class_slot)}"><strong>${escapeHtml(displayDate(fromIsoDate(b.class_date)))} · ${TIMES[Number(b.class_slot)]}</strong><button class="secondary" type="button" data-cancel-booking>Cancelar esta reserva</button></div>`).join('');
  }
  $('showMyBookings').onclick=loadMyBookings;
  $('myBookings').onclick=async e=>{
    const button=e.target.closest('[data-cancel-booking]'); if(!button)return;
    const name=$('memberName').value.trim().replace(/\s+/g,' ');
    if(!validName(name)){notify('Vuelve a escribir el nombre y los dos apellidos de la reserva.');return;}
    button.disabled=true;
    const item=button.closest('.my-booking');
    const {data,error}=await db.rpc('cancel_class',{p_class_date:item.dataset.date,p_slot:Number(item.dataset.slot),p_member_name:name});
    if(error){if(String(error.message||'').includes('CANCELACION_MENOS_DE_1HORA'))notify('No puedes cancelar la reserva porque falta menos de una hora para la clase.');else showDbError(error);button.disabled=false;return;}
    notify(data?.late?'Cancelación registrada. Se avisará a los entrenadores.':'Reserva cancelada.');
    await loadMyBookings(); await loadCounts(); render();
  };
  $('trainerOpen').onclick=()=>{$('trainerModal').classList.add('show');$('trainerName').focus();};
  $('closeBookingConfirmation').onclick=closeBookingConfirmation;
  $('bookingConfirmation').onclick=e=>{if(e.target===$('bookingConfirmation'))closeBookingConfirmation();};
  $('noticeClose').onclick=closeNotice;
  $('notice').onclick=e=>{if(e.target===$('notice'))closeNotice();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeBookingConfirmation();closeNotice();}});
  $('closeModal').onclick=()=>{$('trainerModal').classList.remove('show');setTrainerPanel(false);};
  $('trainerModal').onclick=e=>{if(e.target===$('trainerModal')){$('trainerModal').classList.remove('show');setTrainerPanel(false);}};
  window.gymTrainerLogin=async()=>{
    if(!ready){notify('Primero hay que configurar la base de datos compartida.');return;}
    const input=$('trainerName').value.trim();if(!validName(input)){notify('Escribe tu nombre y tus dos apellidos.');return;}
    const {data,error}=await db.rpc('trainer_data',{p_key:input});if(error){console.error('No se pudo validar el entrenador:',error);notify(error.message||'No se pudo validar el acceso.');return;}
    trainerKey=input;trainerData=data;trainerView='today';setTrainerPanel(true);renderTrainerView();
  };
  $('ownerTrainerNav').onclick=e=>{const button=e.target.closest('[data-trainer-view]');if(button)changeTrainerView(button.dataset.trainerView);};
  $('regularTrainerNav').onclick=e=>{const button=e.target.closest('[data-trainer-view]');if(button)changeTrainerView(button.dataset.trainerView);};
  $('showAddMemberOwner').onclick=()=>changeTrainerView('addMember');
  const openSchedule=async()=>{
    if(trainerData?.is_owner!==true){notify('Solo Fernando puede gestionar los horarios.');return;}
    if(!$('scheduleDate').value)$('scheduleDate').value=dateKey(new Date());
    await changeTrainerView('schedule');await loadScheduleForDate();
  };
  $('showScheduleOwner').onclick=openSchedule;
  $('scheduleDate').onchange=loadScheduleForDate;
  async function loadScheduleForDate(){
    const date=$('scheduleDate').value;if(!date)return;
    const {data,error}=await db.rpc('get_class_counts',{p_start_date:date,p_end_date:date});
    if(error){showDbError(error);return;}
    (data||[]).forEach(row=>{const checkbox=document.querySelector(`[data-open-slot="${Number(row.class_slot)}"]`);if(checkbox)checkbox.checked=Boolean(row.is_open);});
  }
  $('saveScheduleButton').onclick=async()=>{
    if(trainerData?.is_owner!==true){notify('Solo Fernando puede gestionar los horarios.');return;}
    const date=$('scheduleDate').value;if(!date){notify('Selecciona una fecha.');return;}
    const openSlots=[...document.querySelectorAll('[data-open-slot]:checked')].map(input=>Number(input.dataset.openSlot));
    const slotsToClose=(trainerData?.bookings||[])
      .filter(booking=>booking.class_date===date&&!openSlots.includes(Number(booking.class_slot)))
      .map(booking=>TIMES[Number(booking.class_slot)]);
    if(slotsToClose.length){
      const uniqueSlots=[...new Set(slotsToClose)];
      notify(`No se puede cerrar ${uniqueSlots.join(' y ')} porque ya tiene reservas. Cancela primero esas reservas desde «Reservas» y vuelve a guardar.`);
      return;
    }
    const button=$('saveScheduleButton');button.disabled=true;
    try{
      const {error}=await db.rpc('trainer_set_class_schedule',{p_key:trainerKey,p_class_date:date,p_open_slots:openSlots});
      if(error){showDbError(error);return;}
      await fetchTrainerData();renderTrainerView();await loadCounts();await loadScheduleForDate();
      notify(`Horarios actualizados para ${displayDate(fromIsoDate(date),{weekday:'long',day:'numeric',month:'long',year:'numeric'})}.`);
    }catch(error){
      console.error('No se pudieron guardar los horarios:',error);
      notify('No se pudieron guardar los horarios. Comprueba la conexión y que hayas actualizado el esquema de Supabase con el archivo schema.sql.');
    }finally{button.disabled=false;}
  };$('addBookingButton').onclick=async()=>{
    const memberName=$('trainerBookingMember').value;
    const classDate=$('trainerBookingDate').value;
    const classSlot=$('trainerBookingSlot').value;
    if(!memberName){notify('Selecciona un socio dado de alta.');return;}
    if(!classDate){notify('Selecciona el día de la clase.');return;}
    if(classSlot===''){notify('Selecciona una clase.');return;}

    const button=$('addBookingButton');button.disabled=true;
    const {data,error}=await db.rpc('trainer_add_booking',{p_key:trainerKey,p_member_name:memberName,p_class_date:classDate,p_slot:Number(classSlot)});
    if(error){showDbError(error);button.disabled=false;return;}
    $('trainerBookingDate').value='';$('trainerBookingSlot').value='';$('trainerBookingMember').value='';
    await fetchTrainerData();renderTrainerView();await loadCounts();
    notify(`Reserva añadida para ${memberName}. La ha registrado ${data?.created_by||'el entrenador'}.`);
    button.disabled=false;
  };
  $('addMemberButton').onclick=async()=>{
    if(trainerData?.is_owner!==true){notify('Solo Fernando puede dar de alta socios.');return;}
    const name=$('newMemberName').value.trim().replace(/\s+/g,' ');
    if(!validName(name)){notify('Escribe el nombre y los dos apellidos del socio.');return;}
    const button=$('addMemberButton');button.disabled=true;
    const {error}=await db.rpc('trainer_add_member',{p_key:trainerKey,p_member_name:name});
    if(error){showDbError(error);button.disabled=false;return;}
    $('newMemberName').value='';await fetchTrainerData();renderTrainerView();notify(`${name} ya puede reservar clases.`);button.disabled=false;
  };
  $('newMemberName').onkeydown=e=>{if(e.key==='Enter')$('addMemberButton').click();};
  $('logoutTrainer').onclick=()=>setTrainerPanel(false);
  $('historyMembers').onclick=async e=>{
    const clearOne=e.target.closest('[data-clear-member-history]');
    if(clearOne){
      if(trainerData?.is_owner!==true){notify('Solo Fernando puede borrar historiales de socios.');return;}
      const name=historyName;if(!name)return;
      if(!window.confirm(`Vas a borrar únicamente el historial de «${name}». El socio y sus reservas activas se conservarán. Esta acción no se puede deshacer. ¿Quieres continuar?`))return;
      clearOne.disabled=true;const {error}=await db.rpc('trainer_clear_member_history',{p_key:trainerKey,p_member_name:name});
      if(error){showDbError(error);clearOne.disabled=false;return;}
      await fetchTrainerData();renderTrainerView();notify(`Se ha borrado el historial de «${name}». El socio y sus reservas siguen activos.`);return;
    }
    const deleteOne=e.target.closest('[data-delete-member-history]');
    if(deleteOne){
      if(trainerData?.is_owner!==true){notify('Solo Fernando puede borrar historiales de socios.');return;}
      const name=historyName;if(!name)return;
      if(!window.confirm(`Vas a borrar el socio «${name}», todas sus reservas activas y todo su historial. Esta acción no se puede deshacer. ¿Quieres continuar?`))return;
      deleteOne.disabled=true;const {error}=await db.rpc('trainer_delete_member_history',{p_key:trainerKey,p_member_name:name});
      if(error){showDbError(error);deleteOne.disabled=false;return;}
      historyName='';await fetchTrainerData();renderTrainerView();await loadCounts();notify(`Se ha borrado el socio «${name}» y todo su historial.`);return;
    }
    const clearAll=e.target.closest('[data-clear-all-history]');
    if(clearAll){
      if(trainerData?.is_owner!==true){notify('Solo Fernando puede borrar todos los historiales.');return;}
      if(!window.confirm('Vas a borrar todos los historiales de los socios. Se conservarán los socios dados de alta y todas las reservas activas. Esta acción no se puede deshacer. ¿Quieres continuar?'))return;
      clearAll.disabled=true;
      const {error}=await db.rpc('trainer_clear_all_member_history',{p_key:trainerKey});
      if(error){showDbError(error);clearAll.disabled=false;return;}
      await fetchTrainerData();renderTrainerView();notify('Se han borrado todos los historiales. Los socios y las reservas activas se han conservado.');return;
    }
    const member=e.target.closest('[data-member]');if(!member)return;
    historyName=norm(historyName)===norm(member.dataset.member)?'':member.dataset.member;renderMembers();
  };
  $('warningMembers').onclick=e=>{const button=e.target.closest('[data-warning-member]');if(!button)return;warningName=button.dataset.warningMember;renderWarnings();};
  $('warningSessions').onclick=async e=>{
    const button=e.target.closest('[data-warning-action]');if(!button)return;
    const absent=button.dataset.warningAction==='mark';
    if(absent&&!window.confirm(`¿Confirmas que ${warningName} no asistió a esta clase reservada? Se registrará un warning en su historial.`))return;
    if(!absent&&!window.confirm(`¿Quieres anular este warning de ${warningName}?`))return;
    button.disabled=true;
    const {error}=await db.rpc('set_absence',{p_key:trainerKey,p_booking_id:button.dataset.warningBooking,p_absent:absent});
    if(error){showDbError(error);button.disabled=false;return;}
    await fetchTrainerData();renderTrainerView();notify(absent?'Warning registrado en el historial del socio.':'Warning anulado.');
  };
  const handleRosterAction=async e=>{
    const button=e.target.closest('[data-action]');if(!button)return;const bookingId=button.closest('[data-booking]').dataset.booking,action=button.dataset.action;
    if(action==='cancel-booking'){
      if(trainerData?.is_owner!==true){notify('No tienes permiso para cancelar reservas desde el panel.');return;}
      if(!window.confirm('¿Quieres cancelar esta reserva? Se guardará en el historial del socio.'))return;
      button.disabled=true;
      const {error}=await db.rpc('trainer_cancel_booking',{p_key:trainerKey,p_booking_id:bookingId});if(error){showDbError(error);button.disabled=false;return;}
      notify('Reserva cancelada y registrada en el historial.');await fetchTrainerData();renderTrainerView();await loadCounts();return;
    }
    const absent=action==='absence';
    const {error}=await db.rpc('set_absence',{p_key:trainerKey,p_booking_id:bookingId,p_absent:absent});if(error){showDbError(error);return;}await fetchTrainerData();renderTrainerView();
  };
  $('roster').onclick=handleRosterAction;
  $('pastRoster').onclick=handleRosterAction;
  updateRulesContactLinks();
  render();
  if(ready)loadCounts();
  else $('classlist').innerHTML='<div class="empty">Para activar reservas compartidas, configura Supabase en <strong>config.js</strong> y ejecuta <strong>schema.sql</strong> en su editor SQL.</div>';
  setInterval(async()=>{if(!ready)return;await loadCounts();if(trainerKey){try{await fetchTrainerData();renderTrainerView();}catch(e){}}},30000);
})();
