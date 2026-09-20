import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const allowedExtensions = new Set(['.txt', '.md', '.cs', '.json', '.csv', '.html', '.pdf', '.docx']);
const curriculumFile = 'LAp trinh windows.pdf';
let curriculumPromise;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

function extensionOf(name) {
  const match = String(name).toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function routeOf(event) {
  const rawPath = event.path || event.rawPath;
  if (rawPath) return rawPath.split('?')[0].split('/').filter(Boolean).pop();
  if (event.rawUrl) {
    try {
      return new URL(event.rawUrl).pathname.split('/').filter(Boolean).pop();
    } catch {
      return '';
    }
  }
  return '';
}

async function extractText(name, buffer) {
  const extension = extensionOf(name);
  if (['.txt', '.md', '.cs', '.json', '.csv', '.html'].includes(extension)) {
    return buffer.toString('utf8');
  }
  if (extension === '.pdf') {
    const result = await pdfParse(buffer);
    return result.text;
  }
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return '';
}

async function fixedCurriculum() {
  if (!curriculumPromise) {
    curriculumPromise = readFile(join(process.cwd(), 'curriculum', curriculumFile))
      .then((buffer) => extractText(curriculumFile, buffer))
      .then((text) => [{ name: curriculumFile, text: text.trim().slice(0, 120000) }]);
  }
  return curriculumPromise;
}

async function upload(event) {
  const payload = JSON.parse(event.body || '{}');
  const name = String(payload.name || '');
  const encoded = String(payload.content || '');
  const extension = extensionOf(name);
  if (!name || !encoded) return json(400, { error: 'Chưa chọn file giáo trình.' });
  if (!allowedExtensions.has(extension)) return json(400, { error: 'Định dạng hỗ trợ: PDF, DOCX, TXT, MD, CS, JSON, CSV, HTML.' });
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > MAX_FILE_SIZE) return json(413, { error: 'File vượt quá giới hạn 8 MB.' });
  try {
    const text = (await extractText(name, buffer)).trim();
    if (!text) return json(422, { error: 'Không tìm thấy nội dung văn bản trong file.' });
    return json(200, { name, characters: text.length, document: { name, text: text.slice(0, 120000) } });
  } catch (error) {
    return json(422, { error: `Không thể đọc file: ${error.message}` });
  }
}

async function chat(event) {
  const payload = JSON.parse(event.body || '{}');
  const question = String(payload.message || '').trim();
  const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
  let documents;
  try {
    documents = await fixedCurriculum();
  } catch (error) {
    return json(503, { error: `Không thể đọc giáo trình trên Netlify: ${error.message}` });
  }
  if (!question) return json(400, { error: 'Vui lòng nhập câu hỏi.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(503, { error: 'Chưa cấu hình GEMINI_API_KEY trong Netlify Environment variables.' });
  const source = documents.map((document) => `--- ${document.name} ---\n${document.text}`).join('\n\n') || 'Chưa có giáo trình được nạp. Hãy trả lời dựa trên kiến thức C# chuẩn và nói rõ khi không chắc chắn.';
  const transcript = history.map((item) => `${item.role || 'user'}: ${item.content || ''}`).join('\n');
  const prompt = `Bạn là giảng viên môn Lập trình Windows với C#, đang trả lời trực tiếp cho một sinh viên.

MỤC TIÊU:
- Trả lời đúng câu hỏi mới nhất, bám sát giáo trình và không lan sang bài giảng khác.
- Viết bằng tiếng Việt, giọng thân thiện nhưng đi thẳng vào nội dung chuyên môn.

NGUYÊN TẮC BẮT BUỘC:
1. Không mở đầu bằng lời chào, giới thiệu bản thân hoặc nhắc lại câu hỏi. Bắt đầu ngay bằng câu trả lời trọng tâm.
2. Nếu câu hỏi hỏi một khái niệm/cú pháp: trả lời theo thứ tự: kết luận ngắn, giải thích, cú pháp, ví dụ C# hoàn chỉnh, lưu ý thường gặp.
3. Nếu câu hỏi yêu cầu hướng dẫn: chia thành các bước đánh số; mỗi bước phải có hành động cụ thể.
4. Nếu có code, dùng khối mã Markdown với ngôn ngữ csharp và luôn đóng khối mã. Code phải đủ ngữ cảnh để sinh viên hiểu và có thể chạy hoặc chỉ rõ phần cần thay thế.
5. Chỉ dùng tiêu đề Markdown khi cần. Không dùng câu trả lời chung chung, không lặp ý, không thêm phần kết luận dài.
6. Ưu tiên nội dung có trong giáo trình. Nếu giáo trình không đề cập, nói ngắn gọn “Nội dung này không thấy trong giáo trình” rồi dùng kiến thức C#/.NET chuẩn.
7. Không bịa tên lớp, thuộc tính, sự kiện hoặc API. Với WinForms/WPF, nói rõ công nghệ nào đang được minh họa.
8. Trả lời đủ ý và kết thúc trọn vẹn; không dừng giữa câu, giữa danh sách hoặc giữa đoạn code.

GIÁO TRÌNH:
${source}

LỊCH SỬ HỘI THOẠI:
${transcript}

CÂU HỎI MỚI:
${question}`;
  const defaultModel = ['gemini', '3.6-flash'].join('-');
  const model = process.env.GEMINI_MODEL || defaultModel;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2400 } }),
  });
  const result = await response.json();
  if (!response.ok) {
    const apiMessage = result?.error?.message || '';
    const hint = response.status === 401 || response.status === 403
      ? 'API key không hợp lệ hoặc chưa bật quyền Gemini API.'
      : response.status === 404
        ? `Model "${model}" không tồn tại hoặc không được cấp quyền. Hãy kiểm tra GEMINI_MODEL.`
        : apiMessage;
    return json(503, { error: `Gemini từ chối yêu cầu (${response.status}). ${hint}` });
  }
  const answer = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) return json(503, { error: 'Gemini trả về dữ liệu không hợp lệ.' });
  return json(200, { answer });
}

export default async (event) => {
  const route = routeOf(event);
  try {
    if (event.httpMethod === 'GET' && route === 'status') {
      let documents;
      try {
        documents = await fixedCurriculum();
      } catch (error) {
        return json(503, { configured: Boolean(process.env.GEMINI_API_KEY), error: `Không thể đọc giáo trình trên Netlify: ${error.message}` });
      }
      const defaultModel = ['gemini', '3.6-flash'].join('-');
      return json(200, { configured: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || defaultModel, documents: documents.map(({ name, text }) => ({ name, characters: text.length })) });
    }
    if (event.httpMethod === 'POST' && route === 'upload') return json(403, { error: 'Giáo trình của học phần đã được khóa.' });
    if (event.httpMethod === 'POST' && route === 'chat') return await chat(event);
    return json(404, { error: 'Không tìm thấy API.' });
  } catch (error) {
    return json(500, { error: `Lỗi máy chủ: ${error.message}` });
  }
};
