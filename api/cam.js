async function goiAPI_AI(cauHoiCuaBan, anhBase64, mimeType, theLoading) {
            // Gọi đến trạm trung chuyển (file chat.js) của bạn
            const url = `/api/cam`;
            
            const parts = [];
            if (cauHoiCuaBan) parts.push({ text: cauHoiCuaBan });
            if (anhBase64) parts.push({ inlineData: { data: anhBase64, mimeType: mimeType } });

            try {
                const tuyChon = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: parts }] })
                };

                const phanHoi = await fetch(url, tuyChon);
                const duLieu = await phanHoi.json();
                
                theLoading.remove(); 
                
                if(duLieu.candidates && duLieu.candidates.length > 0) {
                    inTinNhan(duLieu.candidates[0].content.parts[0].text, 'ai');
                } else if (duLieu.error) {
                    inTinNhan("Báo lỗi: " + duLieu.error.message, 'ai');
                }
            } catch (loi) {
                theLoading.remove();
                inTinNhan("Lỗi kết nối máy chủ!", 'ai');
            } finally {
                batTatKhungNhap(false); 
                oNhapChu.focus();
            }
        }

        // ĐÂY LÀ HÀM BẠN BỊ THIẾU NÈ:
        function xuLyGuiTinNhan() {
            const noiDung = oNhapChu.value.trim();
            if (noiDung === '' && !anhDangChonBase64) return; 

            inTinNhan(noiDung, 'nguoi-dung', anhDangChonSrc);
            
            const textGuiDi = noiDung;
            const base64GuiDi = anhDangChonBase64;
            const mimeTypeGuiDi = anhDangChonMimeType;

            oNhapChu.value = '';
            xoaHuyAnh();
            
            batTatKhungNhap(true);
            const theLoading = inTinNhan("Bé Mèo đang suy nghĩ... 💬", 'ai dang-go');
            
            goiAPI_AI(textGuiDi, base64GuiDi, mimeTypeGuiDi, theLoading);
        }

        nutGui.addEventListener('click', xuLyGuiTinNhan);
        oNhapChu.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') xuLyGuiTinNhan();
        });
    </script>
</body>
</html>