(() => {
  const TIMES = ['09:00 – 10:00', '18:00 – 18:30', '20:30 – 21:00'];
  const END_TIMES = ['10:00', '18:30', '21:00'];
  const MAX_CAPACITY = 6;
  const config = window.GYM_CONFIG || {};
  const ready = Boolean(window.supabase?.createClient && config.supabaseUrl && config.supabasePublishableKey && !config.supabaseUrl.includes('PEGA_AQUI') && !config.supabasePublishableKey.includes('PEGA_AQUI'));
  const db = ready ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let view = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selected = null, selectedSlot = null, counts = {}, trainerKey = '', trainerData = null, trainerView = 'roster', historyName = '';
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
  function closeNotice() { $('notice').classList.remove('show'); }
  function showDbError(error) { console.error(error); notify(error?.message || 'No se pudo conectar con las reservas.'); }
  function localDay(date) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
  function isBookable(date) { const today=localDay(new Date()), limit=new Date(today); limit.setDate(limit.getDate()+7); const day=localDay(date); return day>=today && day<=limit; }
  function classStart(date,slot) { const [h,m]=TIMES[slot].slice(0,5).split(':').map(Number); return new Date(date.getFullYear(),date.getMonth(),date.getDate(),h,m); }
  function classHasEnded(date,slot) { const [h,m]=END_TIMES[slot].split(':').map(Number); return new Date(date.getFullYear(),date.getMonth(),date.getDate(),h,m)<new Date(); }
  function displayDate(date, options={weekday:'long',day:'numeric',month:'long'}) { const value=new Intl.DateTimeFormat('es-ES',options).format(date); return value.charAt(0).toUpperCase()+value.slice(1); }
  function fromIsoDate(value) { return new Date(`${value}T12:00:00`); }
  async function loadCounts() {
    if(!ready) return;
    const start=new Date(view.getFullYear(),view.getMonth(),1), end=new Date(view.getFullYear(),view.getMonth()+1,0);
    const {data,error}=await db.rpc('get_class_counts',{p_start_date:dateKey(start),p_end_date:dateKey(end)});
    if(error){showDbError(error);return;}
    counts={}; (data||[]).forEach(row=>{counts[classKey(row.class_date,Number(row.class_slot))]=Number(row.remaining_places)});
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
      if(!weekend&&!closed) TIMES.forEach((_,slot)=>{
        const hasStarted=classStart(date,slot)<=new Date(), remaining=counts[classKey(dateKey(date),slot)]??MAX_CAPACITY;
        if(!hasStarted&&remaining>0)remainingClasses++;
      });
      const hasAvailability=!weekend&&!closed&&remainingClasses>0;
      const availabilityLabel=weekend||closed?'':`<span class="day-status ${hasAvailability?'available':'unavailable'}">${hasAvailability?'Clases disponibles':'No hay clases disponibles'}</span>`;
      html+=`<div class="day ${weekend?'weekend':''} ${past?'past':''} ${closed?'closed':''} ${today?'today':''} ${active?'selected':''} ${availabilityLabel?(hasAvailability?'availability-yes':'availability-no'):''}" data-day="${d}" title="${closed?'Reservas disponibles con hasta 7 días de antelación':''}" ${weekend||closed?'aria-disabled="true"':''}><span class="num">${d}</span>${availabilityLabel}</div>`;
    }
    $('days').innerHTML=html;
  }
  function renderClasses() {
    if(!selected){ $('chosenDate').textContent='Selecciona un día'; $('dayCaption').textContent='De lunes a viernes'; $('classlist').innerHTML=ready?'<div class="empty">Pulsa un día disponible del calendario para ver las clases.</div>':'<div class="empty">Conecta Supabase en <strong>config.js</strong> y aplica <strong>schema.sql</strong> para activar las reservas compartidas.</div>'; return; }
    $('chosenDate').textContent=displayDate(selected); const weekend=[0,6].includes(selected.getDay());
    $('dayCaption').textContent=weekend?'No hay clases los fines de semana':'Reserva con hasta 7 días de antelación';
    if(!ready){$('classlist').innerHTML='<div class="empty">Falta configurar la base de datos compartida.</div>';return;}
    $('classlist').innerHTML=weekend?'<div class="empty">Las clases son de lunes a viernes.</div>':TIMES.map((time,slot)=>{
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
  function setTrainerPanel(authorized) { $('trainerLogin').hidden=authorized; $('trainerPanel').hidden=!authorized; if(!authorized){trainerKey='';trainerData=null;historyName='';$('roster').innerHTML='';$('lateList').innerHTML='';$('historyMembers').innerHTML='';$('historyView').innerHTML='';} }
  async function fetchTrainerData() {
    const {data,error}=await db.rpc('trainer_data',{p_key:trainerKey}); if(error) throw error;
    trainerData=data||{bookings:[],events:[]}; return trainerData;
  }
  function currentAbsence(booking) {
    const actions=(trainerData?.events||[]).filter(e=>e.booking_id===booking.id&&(e.event_type==='absence'||e.event_type==='absence_reversed')).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    return actions.length>0&&actions[actions.length-1].event_type==='absence';
  }
  function renderRoster() {
    const items=[...(trainerData?.bookings||[])].sort((a,b)=>`${a.class_date}-${a.class_slot}`.localeCompare(`${b.class_date}-${b.class_slot}`));
    if(!items.length){$('roster').innerHTML='<div class="empty">No hay reservas registradas.</div>';return;}
    const canManageBookings=trainerData?.is_owner===true; let html=''; let last='';
    items.forEach(booking=>{
      const d=fromIsoDate(booking.class_date), slot=Number(booking.class_slot), group=`${booking.class_date}-${slot}`;
      if(group!==last){html+=`<div class="rosterclass">${escapeHtml(displayDate(d))} · ${TIMES[slot]}</div>`;last=group;}
      const ended=classHasEnded(d,slot), absent=currentAbsence(booking);
      const control=absent?'<button class="markabsence" data-action="undo" type="button">Quitar falta</button>':ended?'<button class="markabsence" data-action="absence" type="button">Marcar falta</button>':'<span class="status">Pendiente</span>';
      const adminCancel=canManageBookings?'<button class="markabsence" data-action="cancel-booking" type="button">Cancelar reserva</button>':'';
      html+=`<div class="rosterperson" data-booking="${escapeHtml(booking.id)}"><span>${escapeHtml(booking.member_name)}<small>${ended?'Clase finalizada':'Clase pendiente'}</small></span>${absent?'<span class="status absent">Falta registrada</span>':''}<span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${adminCancel}${control}</span></div>`;
    });
    $('roster').innerHTML=html;
  }
  function renderLate() {
    const late=(trainerData?.events||[]).filter(e=>e.event_type==='cancellation'&&e.late).sort((a,b)=>b.created_at.localeCompare(a.created_at));
    $('lateList').innerHTML=late.length?'<h3>Cancelaciones con menos de dos horas de antelación</h3>'+late.map(e=>`<div class="latecard"><strong>${escapeHtml(e.member_name)}</strong><div>${escapeHtml(displayDate(fromIsoDate(e.class_date)))} · ${TIMES[Number(e.class_slot)]}</div><small>Canceló el ${escapeHtml(new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(e.created_at)))}</small></div>`).join(''):'<div class="empty">No hay cancelaciones con menos de dos horas de antelación.</div>';
  }
  function renderMembers() {
    const names=new Map(); (trainerData?.members||[]).forEach(m=>{if(!names.has(norm(m.member_name)))names.set(norm(m.member_name),m.member_name)}); (trainerData?.bookings||[]).forEach(b=>{if(!names.has(norm(b.member_name)))names.set(norm(b.member_name),b.member_name)}); (trainerData?.events||[]).forEach(e=>{if(!names.has(norm(e.member_name)))names.set(norm(e.member_name),e.member_name)});
    const list=[...names.values()].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    const owner=trainerData?.is_owner===true;
    $('historyMembers').innerHTML=`<h3>Socios</h3>${owner?'<button class="markabsence delete-history" type="button" data-delete-all-history>Borrar todos los socios e historiales</button>':''}${list.length?'<div class="member-list">'+list.map(name=>{const active=historyName&&norm(historyName)===norm(name);return `<div class="member-row"><button class="member-choice ${active?'active':''}" type="button" data-member="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><span class="member-expand">${active?'Cerrar historial':'Ver historial'}</span></button>${active?`<div class="member-history-inline">${renderMemberHistory(name)}</div>`:''}</div>`}).join('')+'</div>':'<div class="empty">Todavía no hay socios en el historial.</div>'}`;
    $('historyView').innerHTML='';
  }
  function renderMemberHistory(name) {
    const events=(trainerData?.events||[]).filter(e=>norm(e.member_name)===norm(name)).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    const counts={reservation:0,cancellation:0,absence:0}, absenceState={};
    events.forEach(e=>{if(e.event_type==='reservation')counts.reservation++;if(e.event_type==='cancellation')counts.cancellation++;if(e.event_type==='absence'||e.event_type==='absence_reversed')absenceState[e.booking_id||`${e.class_date}-${e.class_slot}`]=e.event_type==='absence';});
    counts.absence=Object.values(absenceState).filter(Boolean).length;
    const log=events.map(e=>{
      const labels={reservation:'Reservó',cancellation:e.late?'Canceló con menos de dos horas de antelación':'Canceló',absence:'Falta marcada por entrenador',absence_reversed:'Falta corregida'};
      return `<div class="historyevent">${labels[e.event_type]||escapeHtml(e.event_type)}<small>${escapeHtml(displayDate(fromIsoDate(e.class_date)))} · ${TIMES[Number(e.class_slot)]} · Registro: ${escapeHtml(new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(e.created_at)))}</small></div>`;
    }).join('');
    const deleteButton=trainerData?.is_owner===true?'<button class="markabsence delete-history" type="button" data-delete-member-history>Borrar socio y su historial</button>':'';
    return `<h3>Historial de ${escapeHtml(name)}</h3>${deleteButton}<div class="historysummary">Reservas: <strong>${counts.reservation}</strong> · Cancelaciones: <strong>${counts.cancellation}</strong> · Faltas actuales: <strong>${counts.absence}</strong></div>${log||'<div class="empty">No hay movimientos registrados para este socio.</div>'}`;
  }
  function renderTrainerView() {
    $('showAddMember').hidden=trainerData?.is_owner!==true;
    $('roster').hidden=trainerView!=='roster'; $('lateList').hidden=trainerView!=='late'; $('historyMembers').hidden=trainerView!=='history'; $('historyView').hidden=true; $('memberAddPanel').hidden=trainerView!=='addMember'||trainerData?.is_owner!==true;
    if(trainerView==='roster')renderRoster(); if(trainerView==='late')renderLate(); if(trainerView==='history')renderMembers();
  }
  async function changeTrainerView(name) {
    if(!trainerKey)return; trainerView=name;
    try{await fetchTrainerData();renderTrainerView();}catch(error){showDbError(error);}
  }
  $('prev').onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()-1,1);render();loadCounts();};
  $('next').onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()+1,1);render();loadCounts();};
  $('days').onclick=e=>{const el=e.target.closest('[data-day]');if(!el)return;const d=new Date(view.getFullYear(),view.getMonth(),Number(el.dataset.day));if(!isBookable(d))return;selected=d;selectedSlot=null;renderCalendar();renderClasses();syncReserveButton();};
  $('memberName').oninput=syncReserveButton;
  $('reserve').onclick=async()=>{
    if(!ready||selectedSlot===null||!selected)return;
    if(!validName($('memberName').value)){notify('Escribe tu nombre y tus dos apellidos.');return;}
    if(!isBookable(selected)){notify('Solo se puede reservar con hasta 7 días de antelación.');return;}
    if((counts[classKey(dateKey(selected),selectedSlot)]??MAX_CAPACITY)<=0){notify('Esta clase ya ha alcanzado el máximo de 6 personas.');await loadCounts();return;}
    const bookedDate=new Date(selected.getFullYear(),selected.getMonth(),selected.getDate()), bookedSlot=selectedSlot;
    const name=$('memberName').value.trim().replace(/\s+/g,' '); $('reserve').disabled=true;
    const {error}=await db.rpc('reserve_class',{p_class_date:dateKey(selected),p_slot:selectedSlot,p_member_name:name});
    if(error){if(String(error.message||'').includes('SOCIO_NO_ENCONTRADO'))showMemberNotFound(name);else showDbError(error);await loadCounts();return;}
    $('memberName').value='';selectedSlot=null;await loadCounts();render();openBookingConfirmation(bookedDate,bookedSlot);
  };
  async function loadMyBookings() {
    if(!ready){notify('Falta conectar la base de datos compartida.');return;}
    const name=$('memberName').value.trim().replace(/\s+/g,' ');
    if(!validName(name)){notify('Escribe tu nombre y tus dos apellidos tal como los usaste al reservar.');return;}
    const box=$('myBookings'); box.innerHTML='<div class="empty">Buscando tus reservas…</div>';
    const {data,error}=await db.rpc('my_confirmed_bookings',{p_member_name:name});
    if(error){box.innerHTML='';if(error.code==='PGRST202'||String(error.message||'').includes('my_confirmed_bookings'))notify('Falta actualizar Supabase: ejecuta el schema.sql actualizado en SQL Editor.');else showDbError(error);return;}
    const bookings=data||[];
    if(!bookings.length){box.innerHTML='<div class="empty">No tienes reservas confirmadas.</div>';return;}
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
    if(error){showDbError(error);button.disabled=false;return;}
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
    trainerKey=input;trainerData=data;trainerView='roster';setTrainerPanel(true);renderTrainerView();
  };
  $('showRoster').onclick=()=>changeTrainerView('roster');
  $('showLate').onclick=()=>changeTrainerView('late');
  $('showHistory').onclick=()=>changeTrainerView('history');
  $('showAddMember').onclick=()=>changeTrainerView('addMember');
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
    const deleteOne=e.target.closest('[data-delete-member-history]');
    if(deleteOne){
      if(trainerData?.is_owner!==true){notify('Solo Fernando puede borrar historiales de socios.');return;}
      const name=historyName;if(!name)return;
      if(!window.confirm(`Vas a borrar el socio «${name}», todas sus reservas activas y todo su historial. Esta acción no se puede deshacer. ¿Quieres continuar?`))return;
      deleteOne.disabled=true;const {error}=await db.rpc('trainer_delete_member_history',{p_key:trainerKey,p_member_name:name});
      if(error){showDbError(error);deleteOne.disabled=false;return;}
      historyName='';await fetchTrainerData();renderTrainerView();await loadCounts();notify(`Se ha borrado el socio «${name}» y todo su historial.`);return;
    }
    const deleteAll=e.target.closest('[data-delete-all-history]');
    if(deleteAll){
      if(trainerData?.is_owner!==true){notify('Solo Fernando puede borrar todos los historiales.');return;}
      const names=[...new Map([...(trainerData.members||[]).map(m=>[norm(m.member_name),m.member_name]),...(trainerData.bookings||[]).map(b=>[norm(b.member_name),b.member_name]),...(trainerData.events||[]).map(event=>[norm(event.member_name),event.member_name])]).values()];
      if(!window.confirm(`Vas a borrar los ${names.length} socios, todas sus reservas activas y todos los historiales. Esta acción no se puede deshacer. ¿Quieres continuar?`))return;
      deleteAll.disabled=true;
      for(const name of names){
        const {error}=await db.rpc('trainer_delete_member_history',{p_key:trainerKey,p_member_name:name});
        if(error){showDbError(new Error(`Se habían borrado algunos historiales, pero falló el borrado de «${name}». ${error.message||''}`));deleteAll.disabled=false;await fetchTrainerData();renderTrainerView();await loadCounts();return;}
      }
      historyName='';await fetchTrainerData();renderTrainerView();await loadCounts();notify('Se han borrado todos los socios, sus reservas y sus historiales.');return;
    }
    const member=e.target.closest('[data-member]');if(!member)return;
    historyName=norm(historyName)===norm(member.dataset.member)?'':member.dataset.member;renderMembers();
  };
  $('roster').onclick=async e=>{
    const button=e.target.closest('[data-action]');if(!button)return;const bookingId=button.closest('[data-booking]').dataset.booking,action=button.dataset.action;
    if(action==='cancel-booking'){
      if(trainerData?.is_owner!==true){notify('No tienes permiso para cancelar reservas desde el panel.');return;}
      if(!window.confirm('¿Quieres cancelar esta reserva? Se guardará en el historial del socio.'))return;
      button.disabled=true;
      const {error}=await db.rpc('trainer_cancel_booking',{p_key:trainerKey,p_booking_id:bookingId});if(error){showDbError(error);button.disabled=false;return;}
      notify('Reserva cancelada y registrada en el historial.');await fetchTrainerData();renderRoster();await loadCounts();return;
    }
    const absent=action==='absence';
    const {error}=await db.rpc('set_absence',{p_key:trainerKey,p_booking_id:bookingId,p_absent:absent});if(error){showDbError(error);return;}await fetchTrainerData();renderRoster();
  };
  render();
  if(ready)loadCounts();
  else $('classlist').innerHTML='<div class="empty">Para activar reservas compartidas, configura Supabase en <strong>config.js</strong> y ejecuta <strong>schema.sql</strong> en su editor SQL.</div>';
  setInterval(async()=>{if(!ready)return;await loadCounts();if(trainerKey){try{await fetchTrainerData();renderTrainerView();}catch(e){}}},30000);
})();
