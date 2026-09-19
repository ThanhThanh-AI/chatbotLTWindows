import json
import os
import re
import base64
import urllib.error
import urllib.request
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).parent
CURRICULUM_DIR = ROOT / "curriculum"
STATIC_DIR = ROOT / "static"
ENV_FILE = ROOT / ".env"
MAX_FILE_SIZE = 8 * 1024 * 1024
ALLOWED_EXTENSIONS = {".txt", ".md", ".cs", ".json", ".csv", ".html", ".pdf", ".docx"}


def load_env():
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"\''))


def extract_text(filename, content):
    extension = Path(filename).suffix.lower()
    if extension in {".txt", ".md", ".cs", ".json", ".csv", ".html"}:
        return content.decode("utf-8", errors="ignore")
    if extension == ".pdf":
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            return "[PDF đã lưu. Cài pypdf để trích xuất nội dung PDF.]"
        except Exception as error:
            return f"[Không thể đọc PDF: {error}]"
    if extension == ".docx":
        try:
            from zipfile import ZipFile
            import io
            from xml.etree import ElementTree
            with ZipFile(io.BytesIO(content)) as archive:
                xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            return "\n".join(text.text or "" for text in root.iter() if text.tag.endswith("}t"))
        except Exception as error:
            return f"[Không thể đọc DOCX: {error}]"
    return ""


def curriculum_context():
    documents = []
    for path in sorted(CURRICULUM_DIR.iterdir() if CURRICULUM_DIR.exists() else []):
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS:
            content = path.read_bytes()
            text = extract_text(path.name, content).strip()
            if text:
                documents.append({"name": path.name, "text": text[:120000]})
    return documents


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class ChatHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/api/status":
            documents = curriculum_context()
            json_response(self, 200, {
                "configured": bool(os.environ.get("GEMINI_API_KEY")),
                "model": os.environ.get("GEMINI_MODEL", "-".join(("gemini", "3.6-flash"))),
                "documents": [{"name": doc["name"], "characters": len(doc["text"])} for doc in documents],
            })
            return
        file_path = STATIC_DIR / ("index.html" if route == "/" else route.lstrip("/"))
        if file_path.is_file() and STATIC_DIR in file_path.parents:
            content_type = "text/html; charset=utf-8" if file_path.suffix == ".html" else "text/css; charset=utf-8" if file_path.suffix == ".css" else "application/javascript; charset=utf-8"
            body = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        json_response(self, 404, {"error": "Không tìm thấy tài nguyên."})

    def do_POST(self):
        route = urlparse(self.path).path
        if route == "/api/upload":
            json_response(self, 403, {"error": "Giáo trình của học phần đã được khóa."})
        elif route == "/api/chat":
            self.chat()
        else:
            json_response(self, 404, {"error": "Không tìm thấy API."})

    def upload_curriculum(self):
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > MAX_FILE_SIZE:
            json_response(self, 413, {"error": "File vượt quá giới hạn 8 MB."})
            return
        raw = self.rfile.read(content_length)
        try:
            if content_type.startswith("application/json"):
                payload = json.loads(raw.decode("utf-8"))
                filename = Path(str(payload.get("name", ""))).name
                extension = Path(filename).suffix.lower()
                file_data = base64.b64decode(payload.get("content", ""))
                if not filename or extension not in ALLOWED_EXTENSIONS:
                    raise ValueError("Định dạng hỗ trợ: PDF, DOCX, TXT, MD, CS, JSON, CSV, HTML.")
                if len(file_data) > MAX_FILE_SIZE:
                    raise ValueError("File vượt quá giới hạn 8 MB.")
                text = extract_text(filename, file_data).strip()
                if not text:
                    raise ValueError("Không tìm thấy nội dung văn bản trong file.")
                CURRICULUM_DIR.mkdir(exist_ok=True)
                (CURRICULUM_DIR / filename).write_bytes(file_data)
                json_response(self, 200, {"message": f"Đã nạp {filename} vào kho giáo trình.", "name": filename, "document": {"name": filename, "text": text[:120000]}})
                return
            message = BytesParser(policy=default).parsebytes((f"Content-Type: {content_type}\r\n\r\n").encode() + raw)
            upload = next((part for part in message.iter_attachments() if part.get_filename()), None)
            if upload is None:
                raise ValueError("Chưa chọn file giáo trình.")
            filename = Path(upload.get_filename()).name
            extension = Path(filename).suffix.lower()
            if extension not in ALLOWED_EXTENSIONS:
                raise ValueError("Định dạng hỗ trợ: PDF, DOCX, TXT, MD, CS, JSON, CSV, HTML.")
            file_data = upload.get_payload(decode=True) or b""
            if len(file_data) > MAX_FILE_SIZE:
                raise ValueError("File vượt quá giới hạn 8 MB.")
            CURRICULUM_DIR.mkdir(exist_ok=True)
            (CURRICULUM_DIR / filename).write_bytes(file_data)
            json_response(self, 200, {"message": f"Đã nạp {filename} vào kho giáo trình.", "name": filename})
        except ValueError as error:
            json_response(self, 400, {"error": str(error)})
        except Exception as error:
            json_response(self, 500, {"error": f"Không thể nạp file: {error}"})

    def chat(self):
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            question = str(payload.get("message", "")).strip()
            history = payload.get("history", [])[-8:]
            if not question:
                raise ValueError("Vui lòng nhập câu hỏi.")
            documents = payload.get("documents") or curriculum_context()
            answer = ask_gemini(question, history, documents)
            json_response(self, 200, {"answer": answer})
        except ValueError as error:
            json_response(self, 400, {"error": str(error)})
        except RuntimeError as error:
            json_response(self, 503, {"error": str(error)})
        except Exception as error:
            json_response(self, 500, {"error": f"Lỗi máy chủ: {error}"})

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")


def ask_gemini(question, history, documents):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Chưa cấu hình GEMINI_API_KEY trong file .env.")
    source = "\n\n".join(f"--- {doc['name']} ---\n{doc['text']}" for doc in documents)
    source = source or "Chưa có giáo trình được nạp. Hãy trả lời dựa trên kiến thức C# chuẩn và nói rõ khi không chắc chắn."
    transcript = "\n".join(f"{item.get('role', 'user')}: {item.get('content', '')}" for item in history)
    prompt = f"""Bạn là giảng viên môn Lập trình Windows với C#, đang trả lời trực tiếp cho một sinh viên.

MỤC TIÊU:
- Trả lời đúng câu hỏi mới nhất, bám sát giáo trình và không lan sang bài giảng khác.
- Viết bằng tiếng Việt, giọng thân thiện nhưng đi thẳng vào nội dung chuyên môn.

NGUYÊN TẮC BẮT BUỘC:
1. Không mở đầu bằng lời chào, giới thiệu bản thân hoặc nhắc lại câu hỏi. Bắt đầu ngay bằng câu trả lời trọng tâm.
2. Nếu câu hỏi hỏi một khái niệm/cú pháp: trả lời theo thứ tự: kết luận ngắn, giải thích, cú pháp, ví dụ C# hoàn chỉnh, lưu ý thường gặp.
3. Nếu câu hỏi yêu cầu hướng dẫn: chia thành các bước đánh số; mỗi bước phải có hành động cụ thể.
4. Nếu có code, đặt trong code fence ```csharp và luôn đóng code fence. Code phải đủ ngữ cảnh để sinh viên hiểu và có thể chạy hoặc chỉ rõ phần cần thay thế.
5. Chỉ dùng tiêu đề Markdown khi cần. Không dùng câu trả lời chung chung, không lặp ý, không thêm phần kết luận dài.
6. Ưu tiên nội dung có trong giáo trình. Nếu giáo trình không đề cập, nói ngắn gọn "Nội dung này không thấy trong giáo trình" rồi dùng kiến thức C#/.NET chuẩn.
7. Không bịa tên lớp, thuộc tính, sự kiện hoặc API. Với WinForms/WPF, nói rõ công nghệ nào đang được minh họa.
8. Trả lời đủ ý và kết thúc trọn vẹn; không dừng giữa câu, giữa danh sách hoặc giữa đoạn code.

GIÁO TRÌNH:
{source}

LỊCH SỬ HỘI THOẠI:
{transcript}

CÂU HỎI MỚI:
{question}"""
    model = os.environ.get("GEMINI_MODEL", "-".join(("gemini", "3.6-flash")))
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    request_body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2400}}).encode()
    request = urllib.request.Request(endpoint, data=request_body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
        return result["candidates"][0]["content"]["parts"][0]["text"]
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="ignore")
        if error.code in (401, 403):
            message = "API key không hợp lệ hoặc chưa bật quyền Gemini API."
        elif error.code == 404:
            message = f'Model "{model}" không tồn tại hoặc không được cấp quyền. Hãy kiểm tra GEMINI_MODEL.'
        else:
            message = details[:240]
        raise RuntimeError(f"Gemini từ chối yêu cầu ({error.code}). {message}") from error
    except (KeyError, IndexError) as error:
        raise RuntimeError("Gemini trả về dữ liệu không hợp lệ.") from error


if __name__ == "__main__":
    load_env()
    CURRICULUM_DIR.mkdir(exist_ok=True)
    port = int(os.environ.get("PORT", "8000"))
    print(f"C# Mentor đang chạy tại http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), ChatHandler).serve_forever()
