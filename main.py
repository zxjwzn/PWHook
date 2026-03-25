import shutil
import subprocess
from pathlib import Path

# 配置你的路径
ASAR_PATH = Path(r"D:\Applications\PerfectWorld\resources\app.asar")
UNPACK_DIR = Path(r"D:\Codes\JavaScript\PerfectWorld\PWunpack")
HOOK_SOURCE_DIR = Path(r"D:\Codes\JavaScript\PerfectWorld\PWHook\hook_source")
BACKGROUND_JS = UNPACK_DIR / "background.js"

HOOK_PAYLOAD = "require('./hook_source/pw_hook_index.js');\n"

def main():
    print("[*] 1. 解包应用...")
    subprocess.run(f'asar extract "{ASAR_PATH}" "{UNPACK_DIR}"', shell=True, check=True)

    print("[*] 2. 拷贝 Hook 核心库...")
    target_hook_dir = UNPACK_DIR / "hook_source"
    if target_hook_dir.exists():
        shutil.rmtree(target_hook_dir)
    shutil.copytree(HOOK_SOURCE_DIR, target_hook_dir)

    print("[*] 3. 盲注入口点 (在 background 头部添加 Hook 环境)...")
    content = BACKGROUND_JS.read_text(encoding="utf-8")
    if HOOK_PAYLOAD not in content:
        # 无视任何混淆，直接插在第一行
        BACKGROUND_JS.write_text(HOOK_PAYLOAD + content, encoding="utf-8")
        print("[+] 盲注成功！")
    else:
        print("[-] 已经注入过了，跳过。")

    print("[*] 4. 重新打包替换...")
    subprocess.run(f'asar pack "{UNPACK_DIR}" "{ASAR_PATH}"', shell=True, check=True)
    print("=== 注入完成，启动完美平台即可！ ===")

if __name__ == "__main__":
    main()
