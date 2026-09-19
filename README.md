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

## Deploy lên Netlify

1. Đẩy toàn bộ thư mục này lên GitHub/GitLab.
2. Vào Netlify, chọn **Add new site > Import an existing project** và chọn repository.
3. Netlify sẽ đọc `netlify.toml`: thư mục publish là `static`, function nằm trong `netlify/functions`.
4. Vào **Site configuration > Environment variables** và thêm:

```text
GEMINI_API_KEY=your-gemini-api-key
```

5. Deploy lại site. Netlify tự chạy `npm install` dựa trên `package.json`.

Khi chạy trên Netlify, Function đọc PDF cố định từ `curriculum/` nhờ cấu hình `included_files`; file này không nằm trong thư mục publish nên người dùng không thể tải trực tiếp từ website.
