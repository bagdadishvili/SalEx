// views/assistant.js — "🤖 AI" page (v18): chat with Claude about the selected month, review
// its proposed changes (nothing is applied without ✓), plus "🩺 შემოწმება" — the data check —
// and the list of "fix in the app" notes the assistant wrote.

import { getState, updateState, budgetMonthKey } from '../state.js';
import { getSelectedMonth, monthLabelFull } from '../monthNav.js';
import { renderMonthNav } from '../components.js';
import { el, toast, undoToast, confirmDialog } from '../ui.js';
import { ACTIONS } from '../actions.js';
import { initMonth } from '../monthEngine.js';
import { runDiagnostics, diagnosticsText } from '../diagnostics.js';
import { getAiKey, setAiKey, callClaude, buildContext, TOOL_MAP, AI_MODEL } from '../ai.js';

// Conversation lives in memory for this session (not saved, not synced).
const chat = { messages: [], view: [], pending: [], lastCtx: '', busy: false };

function addNote(title, detail) {
  updateState(d => {
    const list = Array.isArray(d.settings.aiNotes) ? d.settings.aiNotes.slice() : [];
    list.push({ id: `n_${Date.now().toString(36)}`, at: new Date().toISOString(), title: String(title).slice(0, 120), detail: String(detail).slice(0, 2000) });
    d.settings.aiNotes = list.slice(-50);
    return d;
  });
}

export function renderAssistant(root) {
  const container = el('div', { class: 'ai-view' });
  root.appendChild(container);
  container.appendChild(renderMonthNav(() => drawChecks()));

  // ---- key / intro ----
  const keyCard = el('div', { class: 'card' });
  container.appendChild(keyCard);
  function drawKey() {
    keyCard.innerHTML = '';
    keyCard.appendChild(el('div', { class: 'card__title', text: '🤖 AI ასისტენტი' }));
    keyCard.appendChild(el('p', { class: 'card__sub', text: 'მიწერე ჩვეულებრივად, მაგ.: „დანაზოგიდან 100 € დავხარჯე მანქანის შეკეთებაზე" ან „კვება მთლიანად დაიხარჯა" — AI შემოგთავაზებს ცვლილებებს, შენ მონიშნავ და დაადასტურებ. თავისით არაფერს ცვლის.' }));
    const has = !!getAiKey();
    const input = el('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API გასაღები' });
    const save = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: 'შენახვა' });
    save.addEventListener('click', () => { if (!input.value.trim()) return; setAiKey(input.value); input.value = ''; toast('გასაღები შენახულია ამ მოწყობილობაზე ✓'); drawKey(); });
    const remove = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'გასაღების წაშლა' });
    remove.addEventListener('click', async () => { if (await confirmDialog('წავშალო API გასაღები ამ მოწყობილობიდან?')) { setAiKey(''); drawKey(); } });
    keyCard.appendChild(el('details', { class: 'help-details', ...(has ? {} : { open: '' }) }, [
      el('summary', { text: has ? '🔑 გასაღები ჩაწერილია (შეცვლა / წაშლა)' : '🔑 ჯერ ჩაწერე Anthropic API გასაღები' }),
      el('p', { class: 'card__sub', text: 'გასაღებს ქმნი console.anthropic.com → API Keys (ფასიანია, მოხმარების მიხედვით). ის ინახება მხოლოდ ამ მოწყობილობაზე — ბექაფებში და სინქრონიზაციაში არ გადადის. როცა წერ, AI-ს (Anthropic) ეგზავნება არჩეული თვის ციფრები, კატეგორიები და შემოწმების შედეგი.' }),
      el('div', { class: 'btn-row' }, [input, save, has ? remove : null]),
      el('p', { class: 'card__sub', text: `მოდელი: ${AI_MODEL}` })
    ]));
  }
  drawKey();

  // ---- chat ----
  const chatCard = el('div', { class: 'card' });
  const log = el('div', { class: 'ai-chat' });
  const box = el('textarea', { placeholder: 'მაგ.: საწვავში დარჩენილი 40 € კვებაზე დაიხარჯა', 'aria-label': 'შეტყობინება AI-ს' });
  const send = el('button', { type: 'button', class: 'btn btn--primary', text: 'გაგზავნა' });
  const clear = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'ახალი საუბარი' });
  clear.addEventListener('click', () => { Object.assign(chat, { messages: [], view: [], pending: [], lastCtx: '' }); drawLog(); });
  chatCard.append(el('div', { class: 'card__title', text: '💬 საუბარი' }), log, el('div', { class: 'ai-input' }, [box, send]), el('div', { class: 'btn-row' }, [clear]));
  container.appendChild(chatCard);

  function drawLog() {
    log.innerHTML = '';
    if (!chat.view.length) log.appendChild(el('div', { class: 'ai-msg ai-msg--sys', text: `თვე: ${monthLabelFull(getSelectedMonth())}` }));
    chat.view.forEach(item => {
      if (item.type === 'proposal') { log.appendChild(proposalNode(item)); return; }
      log.appendChild(el('div', { class: `ai-msg ai-msg--${item.who}`, text: item.text }));
    });
    if (chat.busy) log.appendChild(el('div', { class: 'ai-msg ai-msg--sys', text: '⏳ AI ფიქრობს…' }));
  }

  function proposalNode(item) {
    const wrap = el('div', { class: 'ai-proposal' });
    wrap.appendChild(el('div', { class: 'card__sub', text: item.done ? item.done : `შემოთავაზებული ცვლილებები (${monthLabelFull(item.key)}):` }));
    item.calls.forEach(c => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = c.checked !== false;
      cb.disabled = !!item.done;
      cb.addEventListener('change', () => { c.checked = cb.checked; });
      wrap.appendChild(el('label', { class: 'ai-proposal__row' }, [cb, el('span', { text: c.label + (c.result ? `\n→ ${c.result}` : '') })]));
    });
    if (!item.done) {
      const ok = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: '✓ შესრულება' });
      const no = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: '✕ არა' });
      ok.addEventListener('click', () => applyProposal(item, true));
      no.addEventListener('click', () => applyProposal(item, false));
      wrap.appendChild(el('div', { class: 'btn-row' }, [ok, no]));
    }
    return wrap;
  }

  /** Describes a proposed call in plain words, by dry-running it on a throw-away copy. */
  function describe(key, name, input) {
    const [action, map] = TOOL_MAP[name] || [];
    if (!action) return { label: `${name} (უცნობი მოქმედება)`, ok: false };
    try {
      const copy = JSON.parse(JSON.stringify(getState()));
      if (!copy.months[key]) initMonth(copy, key);
      return { label: ACTIONS[action](copy, key, map(input)), ok: true };
    } catch (e) { return { label: `⚠️ ${e.message}`, ok: false }; }
  }

  function applyProposal(item, yes) {
    const results = [];
    if (yes) {
      const chosen = item.calls.filter(c => c.checked !== false && c.ok);
      const before = JSON.parse(JSON.stringify({ months: getState().months, categories: getState().categories, planFree: getState().settings.planFree }));
      updateState(d => {
        if (!d.months[item.key]) initMonth(d, item.key);
        item.calls.forEach(c => {
          if (!chosen.includes(c)) { results.push({ id: c.id, text: c.ok ? 'მომხმარებელმა არ მონიშნა — არ შესრულდა' : `არ შესრულდა: ${c.label}`, error: !c.ok }); return; }
          try {
            const [action, map] = TOOL_MAP[c.name];
            c.result = '✓ ' + ACTIONS[action](d, item.key, map(c.input));
            results.push({ id: c.id, text: `შესრულდა: ${c.result}` });
          } catch (e) { c.result = `⚠️ ${e.message}`; results.push({ id: c.id, text: `შეცდომა: ${e.message}`, error: true }); }
        });
        return d;
      });
      item.done = `✓ შესრულდა ${chosen.length} ცვლილება`;
      undoToast('AI-ს ცვლილებები შესრულდა', () => {
        updateState(d => {
          const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); return c; };
          d.months = strip(before.months); d.categories = strip(before.categories); d.settings.planFree = strip(before.planFree);
          return d;
        });
        toast('დაბრუნდა ✓');
      });
    } else {
      item.calls.forEach(c => results.push({ id: c.id, text: 'მომხმარებელმა უარყო — არ შესრულდა' }));
      item.done = '✕ უარყოფილია';
    }
    // The model gets the outcome with the next message.
    chat.pending = chat.pending.filter(p => !results.some(r => r.id === p.tool_use_id));
    results.forEach(r => chat.pending.push({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.error ? { is_error: true } : {}) }));
    drawLog();
    drawChecks();
  }

  async function sendMessage() {
    const text = box.value.trim();
    if (!text || chat.busy) return;
    if (!getAiKey()) { toast('ჯერ ჩაწერე API გასაღები (ზემოთ)', 'error'); return; }
    const key = getSelectedMonth();
    // undecided proposals count as "not done"
    chat.view.forEach(v => { if (v.type === 'proposal' && !v.done) { v.done = '— გამოტოვებულია'; v.calls.forEach(c => chat.pending.push({ type: 'tool_result', tool_use_id: c.id, content: 'მომხმარებელმა არ დაადასტურა — არ შესრულდა' })); } });
    const findings = runDiagnostics(getState(), { currentKey: budgetMonthKey() });
    const ctx = JSON.stringify(buildContext(getState(), key, findings));
    const content = [...chat.pending];
    if (ctx !== chat.lastCtx) { content.push({ type: 'text', text: `აპის მონაცემები ახლა (JSON):\n${ctx}` }); chat.lastCtx = ctx; }
    content.push({ type: 'text', text });
    chat.pending = [];
    const startLen = chat.messages.length;
    chat.messages.push({ role: 'user', content });
    chat.view.push({ who: 'user', text });
    box.value = '';
    chat.busy = true; drawLog();
    try {
      await converse(key);
    } catch (e) {
      chat.view.push({ who: 'sys', text: `⚠️ ${e.message}` });
      // keep the conversation valid: back to before this message; owed results stay owed
      chat.messages.length = startLen;
      chat.pending = content.filter(b => b.type === 'tool_result');
      chat.lastCtx = '';
    } finally {
      chat.busy = false; drawLog();
    }
  }

  /** One model turn. report_issue is answered at once (and the model continues); data changes wait for ✓. */
  async function converse(key, depth = 0) {
    const res = await callClaude(chat.messages);
    chat.messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'refusal') { chat.view.push({ who: 'sys', text: 'AI-მ ამ მოთხოვნაზე პასუხი არ გასცა. სცადე სხვაგვარად ჩამოყალიბება.' }); return; }
    const texts = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (texts) chat.view.push({ who: 'ai', text: texts });
    if (res.stop_reason === 'max_tokens') chat.view.push({ who: 'sys', text: 'პასუხი შუაზე გაწყდა — სცადე უფრო მოკლე კითხვა.' });
    const uses = res.content.filter(b => b.type === 'tool_use');
    const issues = uses.filter(u => u.name === 'report_issue');
    const actions = uses.filter(u => u.name !== 'report_issue');
    issues.forEach(u => {
      addNote(u.input.title || 'შენიშვნა', u.input.detail || '');
      chat.view.push({ who: 'sys', text: `📝 ჩაინიშნა გასასწორებლად: ${u.input.title}` });
    });
    const issueResults = issues.map(u => ({ type: 'tool_result', tool_use_id: u.id, content: 'ჩაინიშნა' }));
    if (actions.length) {
      const calls = actions.map(u => ({ id: u.id, name: u.name, input: u.input, checked: true, ...describe(key, u.name, u.input) }));
      chat.view.push({ type: 'proposal', key, calls });
      chat.pending.push(...issueResults);
      return;
    }
    // Only notes were filed: give the results back so the model can finish its answer.
    if (issueResults.length && res.stop_reason === 'tool_use' && depth < 2) {
      chat.messages.push({ role: 'user', content: issueResults });
      await converse(key, depth + 1);
    }
  }

  send.addEventListener('click', sendMessage);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMessage(); });
  drawLog();

  // ---- checks + notes ----
  const checksCard = el('div', { class: 'card' });
  container.appendChild(checksCard);
  function drawChecks() {
    drawLog();
    const state = getState();
    const findings = runDiagnostics(state, { currentKey: budgetMonthKey() });
    const notes = state.settings.aiNotes || [];
    checksCard.innerHTML = '';
    checksCard.appendChild(el('div', { class: 'card__title', text: `🩺 შემოწმება (${findings.length})` }));
    checksCard.appendChild(el('p', { class: 'card__sub', text: 'აპი თავად ეძებს ციფრებს, რომლებიც ერთმანეთს არ ემთხვევა (ყველა თვეში). არაფერს ცვლის — მხოლოდ გეუბნება, რა შეამოწმო და როგორ გაასწორო.' }));
    if (!findings.length) checksCard.appendChild(el('div', { class: 'card__sub', text: '✓ პრობლემა ვერ ვიპოვე.' }));
    findings.forEach(f => checksCard.appendChild(el('div', { class: `diag-item diag-item--${f.level}` }, [
      el('div', { class: 'diag-item__title', 'data-noedit': '', text: `${f.month ? `${monthLabelFull(f.month)}: ` : ''}${f.title}` }),
      el('div', { class: 'diag-item__fix', 'data-noedit': '', text: f.fix })
    ])));
    checksCard.appendChild(el('div', { class: 'card__title', style: 'margin-top:12px', text: `📝 პროგრამულად გასასწორებელი (${notes.length})` }));
    checksCard.appendChild(el('p', { class: 'card__sub', text: 'AI აქ ინიშნავს, რაც აპის კოდში უნდა შეიცვალოს. „📋 კოპირება" — ტექსტი, რომელსაც დეველოპერს (Claude-ს) გადასცემ.' }));
    notes.slice().reverse().forEach(n => {
      const del = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'წაშლა', text: '✕' });
      del.addEventListener('click', () => { updateState(d => { d.settings.aiNotes = (d.settings.aiNotes || []).filter(x => x.id !== n.id); return d; }); drawChecks(); });
      checksCard.appendChild(el('div', { class: 'diag-item diag-item--bug', style: 'display:flex;gap:8px' }, [
        el('div', { style: 'flex:1' }, [
          el('div', { class: 'diag-item__title', 'data-noedit': '', text: `${n.at.slice(0, 10)} · ${n.title}` }),
          el('div', { class: 'diag-item__fix', 'data-noedit': '', text: n.detail })
        ]),
        del
      ]));
    });
    const copy = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '📋 კოპირება' });
    copy.addEventListener('click', async () => {
      const txt = diagnosticsText(findings, notes);
      try { await navigator.clipboard.writeText(txt); toast('დაკოპირდა ✓'); } catch { toast('კოპირება ვერ მოხერხდა', 'error'); }
    });
    checksCard.appendChild(el('div', { class: 'btn-row' }, [copy]));
  }
  drawChecks();
}
