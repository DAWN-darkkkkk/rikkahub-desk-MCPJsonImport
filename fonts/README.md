# 此目录存放随应用分发的内置字体。
#
# 字体文件（.woff2 / .woff / .ttf / .otf / .ttc）直接放这里即可，后端 listBuiltinFonts
# 会自动扫描，前端下拉框「应用自带」分组里显示，并注入 @font-face。
#
# 可选：放一个 manifest.json 给字体配中文名/精调 fallback，格式：
#   {
#     "LXGWWenKai-Regular.woff2": { "label": "霞鹜文楷", "family": "\"霞鹜文楷\", \"Microsoft YaHei\", sans-serif" }
#   }
# 不写就用文件名自动派生（label 去字重后缀，family = "<文件名stem>, system-ui, sans-serif"）。
#
# 打包：tauri.conf.json 的 resources 把本目录拷进 Windows 安装包；build-linux.yml 的
# assemble 步骤把它拷进 Linux tar.gz。两平台都随应用走，不依赖用户系统是否装了该字体。
