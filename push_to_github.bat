@echo off
echo ============================================
echo   Push Dashboard Anomali ke GitHub
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] Mengatur remote origin...
git remote set-url origin https://github.com/imaiku/anomalise3602.git 2>nul || git remote add origin https://github.com/imaiku/anomalise3602.git

echo [2/4] Menambahkan semua file...
git add -A

echo [3/4] Membuat commit...
git commit -m "feat: initial dashboard anomali SE2026 - login, dashboard, admin panel"

echo [4/4] Push ke GitHub (main branch)...
git push -u origin main 2>nul || git push -u origin master

echo.
echo ============================================
echo  Selesai! Vercel akan auto-deploy dalam
echo  1-2 menit di: https://anomalise3602.vercel.app
echo ============================================
echo.
pause
