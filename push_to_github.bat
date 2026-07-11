@echo off
echo ============================================
echo   Push Dashboard Anomali ke GitHub
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] Memeriksa konfigurasi Git...
git config user.name >nul 2>&1
if errorlevel 1 (
    echo [PENTING] Git user.name belum dikonfigurasi.
    set /p git_name="Masukkan Nama Git Anda: "
    if not "%git_name%"=="" (
        git config --local user.name "%git_name%"
    ) else (
        git config --local user.name "Kontributor Lebak"
    )
)

git config user.email >nul 2>&1
if errorlevel 1 (
    echo [PENTING] Git user.email belum dikonfigurasi.
    set /p git_email="Masukkan Email Git Anda: "
    if not "%git_email%"=="" (
        git config --local user.email "%git_email%"
    ) else (
        git config --local user.email "kontributor@lebak.bps.go.id"
    )
)

echo [2/4] Mengatur remote origin...
git remote set-url origin https://github.com/imaiku/anomalise3602.git 2>nul || git remote add origin https://github.com/imaiku/anomalise3602.git

echo [3/4] Menambahkan semua file...
git add -A

echo [4/4] Membuat commit...
set commit_msg=feat: update dashboard anomali SE2026
set /p user_msg="Masukkan pesan commit (tekan Enter untuk default: '%commit_msg%'): "
if not "%user_msg%"=="" set commit_msg=%user_msg%

git commit -m "%commit_msg%"

echo [5/5] Push ke GitHub...
:: Mendapatkan nama branch aktif saat ini
for /f "tokens=*" %%i in ('git symbolic-ref --short HEAD 2^>nul') do set current_branch=%%i
if "%current_branch%"=="" set current_branch=main

echo Mendorong ke branch %current_branch%...
git push -u origin %current_branch%

echo.
echo ============================================
echo  Selesai! Vercel akan auto-deploy dalam
echo  1-2 menit di: https://anomalise3602.vercel.app
echo ============================================
echo.
pause
