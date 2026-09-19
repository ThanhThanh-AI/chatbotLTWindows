const state = { history: [], busy: false };
const messages = document.querySelector('#messages');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');

function renderMarkdown(content) {
  const codeBlocks = [];
  let source = String(content).replace(/```(?:csharp|cs|C#)?\s*([\s\S]*?)```/g, (_, code) => {
    const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return token;
  });
  source = escapeHtml(source)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)(?:<br>|$)/g, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
  codeBlocks.forEach((block, index) => { source = source.replace(`@@CODE_BLOCK_${index}@@`, block); });
  return source;
}

function escapeHtml(content) {
  return content.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

function addMessage(role, content) {
  const item = document.createElement('div');
  item.className = `message ${role}`;
  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'BẠN' : 'C# MENTOR';
  item.appendChild(label);
  if (role === 'assistant') item.insertAdjacentHTML('beforeend', renderMarkdown(content));
  else item.appendChild(document.createTextNode(content));
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

async function sendMessage(text) {
  if (!text || state.busy) return;
  state.busy = true;
  addMessage('user', text);
  input.value = '';
  const thinking = document.createElement('div');
  thinking.className = 'message assistant';
  thinking.textContent = 'Đang đọc giáo trình và soạn câu trả lời...';
  messages.appendChild(thinking);
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: text, history: state.history}) });
    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); } catch { data = {}; }
    thinking.remove();
    if (!response.ok) throw new Error(data.error || `Netlify Function trả về lỗi HTTP ${response.status}.`);
    addMessage('assistant', data.answer);
    state.history.push({role: 'user', content: text}, {role: 'assistant', content: data.answer});
  } catch (error) {
    thinking.remove();
    addMessage('assistant', `Chưa thể trả lời: ${error.message}`);
  } finally { state.busy = false; input.focus(); }
}

form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(input.value.trim()); });
input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
document.querySelectorAll('[data-question]').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.question; input.focus(); }));

async function refreshStatus() {
  try {
    const response = await fetch('/api/status'); const data = await response.json();
    document.querySelector('#document-count').textContent = `${data.documents?.length || 1} tài liệu`;
    document.querySelector('#document-status').textContent = data.documents?.[0]?.name || 'Lập trình Windows.pdf';
    document.querySelector('#api-status').textContent = data.configured ? 'Gemini đã sẵn sàng' : 'Chưa có Gemini API key';
    document.querySelector('.status-dot').style.background = data.configured ? 'var(--teal)' : 'var(--amber)';
    document.querySelector('#model-name').textContent = data.model;
  } catch { document.querySelector('#api-status').textContent = 'Server chưa khởi động'; }
}
refreshStatus();
