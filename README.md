# C# Mentor

Chatbot hỏi đáp kiến thức lập trình Windows với C#, dùng Gemini và giáo trình riêng của môn học.

## Chạy dự án

1. Cài Python 3.10+.
2. Sao chép `.env.example` thành `.env`.
3. Lấy API key tại [Google AI Studio](https://aistudio.google.com/app/apikey), rồi điền vào `GEMINI_API_KEY`.
4. Chạy:

```powershell
python server.py
```

5. Mở http://localhost:8000.

Giáo trình cố định nằm trong thư mục `curriculum/` và không có chức năng cho người dùng tải hoặc thay thế tài liệu. PDF cần cài thêm `pypdf` nếu muốn chạy local: `py -m pip install pypdf`.

API key chỉ nằm ở server và không được gửi xuống trình duyệt. Mô hình mặc định hiện tại là model Gemini đang được cấu hình trong mã nguồn; có thể đổi bằng `GEMINI_MODEL` trong `.env` khi chạy local.

## Deploy lên Netlify không cần GitHub

> Không kéo-thả riêng thư mục `static`: cách đó chỉ đưa giao diện tĩnh lên Netlify và không deploy `netlify/functions`, nên chatbot sẽ không gọi được Gemini. Dùng Netlify CLI để deploy trực tiếp cả giao diện, Function và giáo trình.

1. Cài Node.js LTS từ https://nodejs.org/ rồi mở PowerShell mới.
2. Đăng nhập Netlify:

```powershell
npx netlify-cli login
```

3. Di chuyển vào thư mục dự án:

```powershell
cd D:\DEMO\chatbot_LTWindows
```

4. Tạo site mới và deploy trực tiếp:

```powershell
npx netlify-cli deploy --prod --dir=static --functions=netlify/functions
```

Nếu CLI hỏi tạo site mới, chọn **Create & configure a new site**, sau đó chọn team của bạn. Khi hỏi publish directory, nhập `static`.

5. Thêm API key vào site vừa tạo:

```powershell
npx netlify-cli env:set GEMINI_API_KEY "API_KEY_MOI_CUA_BAN"
```

Không đặt API key trong lệnh nếu bạn đang chia sẻ màn hình hoặc lưu lịch sử terminal. Khi đó hãy vào **Netlify → Site configuration → Environment variables** và thêm:

```text
GEMINI_API_KEY=your-gemini-api-key
```

6. Deploy lại để Function nhận biến môi trường:

```powershell
npx netlify-cli deploy --prod --dir=static --functions=netlify/functions
```

7. Kiểm tra:

```text
https://TEN-SITE.netlify.app/api/status
```

Nếu trả về `configured: true` và có `documents`, site đã hoạt động.

Khi chạy trên Netlify, Function đọc PDF cố định từ `curriculum/` nhờ cấu hình `included_files`; file này không nằm trong thư mục publish nên người dùng không thể tải trực tiếp từ website.
