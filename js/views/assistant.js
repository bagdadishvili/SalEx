// views/assistant.js — "🤖 AI" page: connect any AI (Claude, ChatGPT, Gemini, OpenRouter, other),
// chat about the budget, review the changes it proposes (nothing is applied without ✓), plus
// "🩺 შემოწმება" (the data check) and the list of "fix in the app" notes the AI wrote.
// The AI can read and change all data (aiTools.js); the conversation lives in memory only.

import { getState, updateState, budgetMonthKey } from '../state.js';
import { getSelectedMonth, monthLabelFull } from '../monthNav.js';
import { renderMonthNav } from '../components.js';
import { el, toast, undoToast, confirmDialog } from '../ui.js';
import { runDiagnostics, diagnosticsText } from '../diagnostics.js';
import { PROVIDERS, getAiConfig, setAiConfig, activeProvider, adapterFor, callModel, listModels, SYSTEM_PROMPT } from '../ai.js';
import { Aliases, TOOL_DEFS, READ_TOOLS, NOTE_TOOL, isWriteTool, runRead, readLabel, snapshotText, applyCall, describeCall } from '../aiTools.js';

const MAX_ROUNDS = 6;            // model turns per message (reading data in between)
const TRIM_AT = 160000;          // characters of conversation before old turns are folded away
const KEEP_AFTER_TRIM = 70000;

// One conversation per app session (not saved, not synced).
const chat = newChat();
function newChat() {
  return { conv: { messages: [] }, who: '', view: [], pending: [], lastCtx: '', busy: false, A: new Aliases(), usage: { input: 0, cached: 0, output: 0 } };
}
function resetChat(note) {
  Object.assign(chat, newChat());
  if (note) chat.view.push({ who: 'sys', text: note });
}

function addNote(title, detail) {
  updateState(d => {
    const list = Array.isArray(d.settings.aiNotes) ? d.settings.aiNotes.slice() : [];
    list.push({ id: `n_${Date.now().toString(36)}`, at: new Date().toISOString(), title: String(title).slice(0, 120), detail: String(detail).slice(0, 2000) });
    d.settings.aiNotes = list.slice(-50);
    return d;
  });
}

/** Conversation and check texts are data, not app wording: no renaming, not in the text list. */
function plain(tag, cls, text) {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}

const fmtK = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n));

export function renderAssistant(root) {
  const container = el('div', { class: 'ai-view' });
  root.appendChild(container);
  container.appendChild(renderMonthNav(() => drawChecks()));

  // ---- connection: which AI, key, model ----
  const keyCard = el('div', { class: 'card' });
  container.appendChild(keyCard);
  let modelList = [];

  function drawKey() {
    keyCard.innerHTML = '';
    const cfg = getAiConfig();
    const p = activeProvider();
    keyCard.appendChild(el('div', { class: 'card__title', text: '🤖 AI ასისტენტი' }));
    keyCard.appendChild(el('p', { class: 'card__sub', text: 'მიწერე ჩვეულებრივად, მაგ.: „დანაზოგიდან 100 € დავხარჯე მანქანის შეკეთებაზე", „ამ გადასახადის ფული ჩემს ანგარიშზე გადავიტანე" ან „ოქტომბერში რაზე დავხარჯეთ ყველაზე მეტი?". AI ხედავს ყველა მონაცემს და გთავაზობს ცვლილებებს — შენ მონიშნავ და დაადასტურებ. თავისით არაფერს ცვლის.' }));

    const providerSel = el('select', { 'aria-label': 'AI სერვისი' }, Object.entries(PROVIDERS).map(([id, pr]) => el('option', { value: id, text: pr.label })));
    providerSel.value = cfg.provider;
    providerSel.addEventListener('change', () => { setAiConfig({ provider: providerSel.value }); modelList = []; drawKey(); });

    const keyIn = el('input', { type: 'password', autocomplete: 'off', placeholder: p.key ? '•••••••• (ჩაწერილია — ახალი ჩაანაცვლებს)' : p.keyHint, 'aria-label': 'API გასაღები' });
    const saveKey = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: 'შენახვა' });
    saveKey.addEventListener('click', () => {
      if (!keyIn.value.trim()) return;
      setAiConfig({ keys: { [cfg.provider]: keyIn.value.trim() } });
      toast('გასაღები შენახულია ამ მოწყობილობაზე ✓');
      drawKey();
    });
    const removeKey = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'გასაღების წაშლა' });
    removeKey.addEventListener('click', async () => {
      if (await confirmDialog('წავშალო ამ სერვისის API გასაღები ამ მოწყობილობიდან?')) { setAiConfig({ keys: { [cfg.provider]: '' } }); drawKey(); }
    });

    const listId = 'ai-model-list';
    const modelIn = el('input', { type: 'text', value: p.model, list: listId, placeholder: 'მოდელის სახელი', 'aria-label': 'მოდელი', autocomplete: 'off' });
    modelIn.addEventListener('change', () => { setAiConfig({ models: { [cfg.provider]: modelIn.value.trim() } }); toast('მოდელი შენახულია ✓'); });
    const datalist = el('datalist', { id: listId }, modelList.map(m => el('option', { value: m })));
    const listBtn = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', text: '📋 მოდელების სია (კავშირის შემოწმება)' });
    const status = el('div', { class: 'card__sub ai-status' });
    listBtn.addEventListener('click', async () => {
      listBtn.disabled = true;
      status.textContent = '⏳ ვამოწმებ…';
      try {
        modelList = await listModels();
        status.textContent = `✓ კავშირი მუშაობს — ${modelList.length} მოდელი. აირჩიე ველში „მოდელი".`;
        datalist.innerHTML = '';
        modelList.forEach(m => datalist.appendChild(el('option', { value: m })));
      } catch (e) { status.textContent = `⚠️ ${e.message}`; }
      listBtn.disabled = false;
    });

    const baseIn = cfg.provider === 'custom' ? el('input', { type: 'url', value: p.base, placeholder: 'https://…/v1', 'aria-label': 'სერვისის მისამართი' }) : null;
    if (baseIn) baseIn.addEventListener('change', () => { setAiConfig({ bases: { custom: baseIn.value.trim() } }); toast('მისამართი შენახულია ✓'); });

    const effortSel = el('select', { 'aria-label': 'ფიქრის სიღრმე' }, [
      el('option', { value: 'low', text: '⚡ ეკონომიური — ნაკლები ტოკენი (საკმარისია ჩვეულებრივ)' }),
      el('option', { value: 'medium', text: '🧠 უფრო ღრმა ფიქრი — რთული კითხვებისთვის' })
    ]);
    effortSel.value = cfg.effort;
    effortSel.addEventListener('change', () => { setAiConfig({ effort: effortSel.value }); toast('შენახულია ✓'); });

    const details = el('details', { class: 'help-details ai-connect', ...(p.key ? {} : { open: '' }) }, [
      el('summary', { text: p.key ? `🔌 ${PROVIDERS[cfg.provider].label} · ${p.model || 'მოდელი არ არის არჩეული'} (შეცვლა)` : '🔌 აირჩიე AI და ჩაწერე მისი გასაღები' }),
      el('div', { class: 'field' }, [el('label', { text: 'AI სერვისი' }), providerSel]),
      el('div', { class: 'field' }, [
        el('label', { text: 'API გასაღები' }),
        el('div', { class: 'ai-key-row' }, [keyIn, saveKey, p.key ? removeKey : null]),
        p.keyUrl ? el('div', { class: 'card__sub' }, ['გასაღების შექმნა: ', el('a', { href: p.keyUrl, target: '_blank', rel: 'noopener', text: p.keyUrl.replace(/^https:\/\//, '') }), ' (ფასიანია მოხმარების მიხედვით; Gemini-ს აქვს უფასო ლიმიტიც)']) : null
      ]),
      baseIn ? el('div', { class: 'field' }, [el('label', { text: 'სერვისის მისამართი (OpenAI-თავსებადი, …/v1)' }), baseIn]) : null,
      el('div', { class: 'field' }, [el('label', { text: 'მოდელი' }), modelIn, datalist]),
      el('div', { class: 'btn-row' }, [listBtn]),
      status,
      el('div', { class: 'field' }, [el('label', { text: 'ფიქრის სიღრმე' }), effortSel]),
      el('p', { class: 'card__sub', text: 'გასაღებები ინახება მხოლოდ ამ მოწყობილობაზე — ბექაფებში და სინქრონიზაციაში არ გადადის. როცა წერ, არჩეულ სერვისს ეგზავნება არჩეული თვის მონაცემები (და რასაც AI დამატებით წაიკითხავს). ტოკენების დასაზოგად: მოკლე ჩანაწერები, მოკლე id-ები, ქეში და მხოლოდ საჭირო მონაცემი.' })
    ]);
    keyCard.appendChild(details);
  }
  drawKey();

  // ---- chat ----
  const chatCard = el('div', { class: 'card' });
  const log = el('div', { class: 'ai-chat', 'aria-live': 'polite' });
  const usageLine = el('div', { class: 'card__sub ai-usage' });
  const box = el('textarea', { placeholder: 'მაგ.: საწვავში დარჩენილი 40 € კვებაზე დაიხარჯა', 'aria-label': 'შეტყობინება AI-ს', rows: '3' });
  const send = el('button', { type: 'button', class: 'btn btn--primary', text: 'გაგზავნა' });
  const clear = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'ახალი საუბარი' });
  clear.addEventListener('click', () => { resetChat(); drawLog(); });
  chatCard.append(el('div', { class: 'card__title', text: '💬 საუბარი' }), log, el('div', { class: 'ai-input' }, [box, send]), el('div', { class: 'btn-row' }, [clear]), usageLine);
  container.appendChild(chatCard);

  function drawLog() {
    log.innerHTML = '';
    if (!chat.view.length) log.appendChild(el('div', { class: 'ai-msg ai-msg--sys', text: `თვე: ${monthLabelFull(getSelectedMonth())}` }));
    chat.view.forEach(item => {
      if (item.type === 'proposal') { log.appendChild(proposalNode(item)); return; }
      log.appendChild(plain('div', `ai-msg ai-msg--${item.who}`, item.text));
    });
    if (chat.busy) log.appendChild(el('div', { class: 'ai-msg ai-msg--sys', text: '⏳ AI ფიქრობს…' }));
    const u = chat.usage;
    usageLine.textContent = u.input || u.output
      ? `ამ საუბარში ≈ ${fmtK(u.input)} შემავალი ტოკენი (${fmtK(u.cached)} ქეშიდან, იაფია) · ${fmtK(u.output)} გამავალი`
      : '';
  }

  function proposalNode(item) {
    const wrap = el('div', { class: 'ai-proposal' });
    wrap.appendChild(el('div', { class: 'card__sub', text: item.done ? item.done : `შემოთავაზებული ცვლილებები (${monthLabelFull(item.key)}):` }));
    item.calls.forEach(c => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = c.checked !== false && c.ok;
      cb.disabled = !!item.done || !c.ok;
      cb.addEventListener('change', () => { c.checked = cb.checked; });
      wrap.appendChild(el('label', { class: 'ai-proposal__row' }, [cb, plain('span', '', c.label + (c.result ? `\n→ ${c.result}` : ''))]));
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

  const resultOf = (c, content, error = false) => ({ id: c.id, gid: c.gid || null, name: c.name, content, ...(error ? { error: true } : {}) });

  function applyProposal(item, yes) {
    const results = [];
    if (yes) {
      const chosen = item.calls.filter(c => c.checked !== false && c.ok);
      const s = getState();
      const before = JSON.parse(JSON.stringify({ months: s.months, categories: s.categories, templates: s.templates, settings: s.settings }));
      updateState(d => {
        item.calls.forEach(c => {
          if (!chosen.includes(c)) { results.push(resultOf(c, c.ok ? 'not done: the user did not tick it' : `not done: ${c.label}`, !c.ok)); return; }
          try {
            c.result = '✓ ' + applyCall(d, item.key, c, chat.A);
            results.push(resultOf(c, `done: ${c.result}`));
          } catch (e) { c.result = `⚠️ ${e.message}`; results.push(resultOf(c, `error: ${e.message}`, true)); }
        });
        return d;
      });
      item.done = `✓ შესრულდა ${chosen.length} ცვლილება`;
      undoToast('AI-ს ცვლილებები შესრულდა', () => {
        updateState(d => {
          const keep = { texts: d.settings.texts, aiNotes: d.settings.aiNotes };
          d.months = before.months; d.categories = before.categories; d.templates = before.templates;
          d.settings = { ...before.settings, ...keep };
          return d;
        });
        toast('დაბრუნდა ✓');
      });
    } else {
      item.calls.forEach(c => results.push(resultOf(c, 'not done: the user declined')));
      item.done = '✕ უარყოფილია';
    }
    // the model learns the outcome with the next message
    chat.pending = chat.pending.filter(p => !results.some(r => r.id === p.id)).concat(results);
    drawLog();
    drawChecks();
  }

  /** Folds old turns away once the conversation gets long (fewer tokens per request). */
  function trimIfLong(A) {
    const msgs = chat.conv.messages;
    if (JSON.stringify(msgs).length < TRIM_AT) return;
    for (let i = 1; i < msgs.length; i++) {
      if (A.isTurnStart(msgs[i]) && JSON.stringify(msgs.slice(i)).length < KEEP_AFTER_TRIM) {
        chat.conv.messages = A.stripThinking ? A.stripThinking(msgs.slice(i)) : msgs.slice(i);
        chat.lastCtx = ''; // the fresh data goes with the next message again
        chat.view.push({ who: 'sys', text: 'საუბრის ძველი ნაწილი დაიკეცა (ტოკენების დასაზოგად).' });
        return;
      }
    }
  }

  async function sendMessage() {
    const text = box.value.trim();
    if (!text || chat.busy) return;
    const p = activeProvider();
    if (!p.key) { toast('ჯერ აირჩიე AI და ჩაწერე გასაღები (ზემოთ)', 'error'); return; }
    // a different AI or model = a new conversation (their internal formats differ)
    const who = `${p.id}|${p.model}|${p.base}`;
    if (chat.who && chat.who !== who) resetChat('AI ან მოდელი შეიცვალა — დაიწყო ახალი საუბარი.');
    chat.who = who;
    const A = adapterFor(p);
    const key = getSelectedMonth();
    // undecided proposals count as "not done"
    chat.view.forEach(v => {
      if (v.type === 'proposal' && !v.done) {
        v.done = '— გამოტოვებულია';
        v.calls.forEach(c => chat.pending.push(resultOf(c, 'not done: the user did not confirm')));
      }
    });
    trimIfLong(A);
    const snap = snapshotText(getState(), key, chat.A);
    const texts = [];
    if (snap !== chat.lastCtx) { texts.push(snap); chat.lastCtx = snap; }
    texts.push(text);
    const startLen = chat.conv.messages.length;
    const owed = chat.pending;
    chat.conv.messages.push(...A.userTurn(owed, texts));
    chat.pending = [];
    chat.view.push({ who: 'user', text });
    box.value = '';
    chat.busy = true; drawLog();
    try {
      await converse(key, A);
    } catch (e) {
      chat.view.push({ who: 'sys', text: `⚠️ ${e.message}` });
      // keep the conversation valid: back to before this message; owed results stay owed
      chat.conv.messages.length = Math.min(chat.conv.messages.length, startLen);
      chat.pending = owed.concat(chat.pending);
      chat.lastCtx = '';
    } finally {
      chat.busy = false; drawLog();
    }
  }

  /** Model turns: reads run at once (and the model continues); changes wait for ✓. */
  async function converse(key, A) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await callModel(chat.conv, SYSTEM_PROMPT, TOOL_DEFS);
      chat.conv.messages.push(res.message);
      ['input', 'cached', 'output'].forEach(k => { chat.usage[k] += res.usage[k] || 0; });
      if (res.text) chat.view.push({ who: 'ai', text: res.text });
      if (res.stop === 'refusal') { chat.view.push({ who: 'sys', text: 'AI-მ ამ მოთხოვნაზე პასუხი არ გასცა. სცადე სხვაგვარად ჩამოყალიბება.' }); return; }
      if (res.stop === 'max') chat.view.push({ who: 'sys', text: 'პასუხი შუაზე გაწყდა — სცადე უფრო მოკლე კითხვა.' });
      if (!res.calls.length) return;
      const results = [];
      const writes = [];
      res.calls.forEach(c => {
        if (READ_TOOLS.has(c.name)) {
          chat.view.push({ who: 'sys', text: `🔎 AI კითხულობს: ${readLabel(c.input || {})}` });
          results.push(resultOf(c, runRead(getState(), key, c.input || {}, chat.A)));
        } else if (c.name === NOTE_TOOL) {
          addNote((c.input && c.input.title) || 'შენიშვნა', (c.input && c.input.detail) || '');
          chat.view.push({ who: 'sys', text: `📝 ჩაინიშნა გასასწორებლად: ${(c.input && c.input.title) || ''}` });
          results.push(resultOf(c, 'saved'));
        } else if (isWriteTool(c.name)) {
          writes.push(c);
        } else {
          results.push(resultOf(c, `unknown tool ${c.name}`, true));
        }
      });
      if (writes.length) {
        chat.view.push({ type: 'proposal', key, calls: writes.map(c => ({ ...c, checked: true, ...describeCall(getState(), key, c, chat.A) })) });
        chat.pending.push(...results);
        return;
      }
      if (round === MAX_ROUNDS - 1) { chat.pending.push(...results); break; }
      chat.conv.messages.push(...A.userTurn(results, []));
      drawLog();
    }
    chat.view.push({ who: 'sys', text: 'AI-მ ბევრი ნაბიჯი გადადგა — სცადე უფრო კონკრეტული კითხვა.' });
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
      plain('div', 'diag-item__title', `${f.month ? `${monthLabelFull(f.month)}: ` : ''}${f.title}`),
      plain('div', 'diag-item__fix', f.fix)
    ])));
    checksCard.appendChild(el('div', { class: 'card__title', style: 'margin-top:12px', text: `📝 პროგრამულად გასასწორებელი (${notes.length})` }));
    checksCard.appendChild(el('p', { class: 'card__sub', text: 'AI აქ ინიშნავს, რაც აპის კოდში უნდა შეიცვალოს. „📋 კოპირება" — ტექსტი, რომელსაც დეველოპერს (Claude-ს) გადასცემ.' }));
    notes.slice().reverse().forEach(n => {
      const del = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': 'წაშლა', text: '✕' });
      del.addEventListener('click', () => { updateState(d => { d.settings.aiNotes = (d.settings.aiNotes || []).filter(x => x.id !== n.id); return d; }); drawChecks(); });
      checksCard.appendChild(el('div', { class: 'diag-item diag-item--bug ai-note' }, [
        el('div', { class: 'ai-note__main' }, [
          plain('div', 'diag-item__title', `${n.at.slice(0, 10)} · ${n.title}`),
          plain('div', 'diag-item__fix', n.detail)
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
