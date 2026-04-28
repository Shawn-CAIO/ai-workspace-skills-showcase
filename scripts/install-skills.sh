#!/bin/bash
#
# install-skills.sh
#
# skills-source/ 의 스킬들을 ~/.claude/skills/ 에 배포한다.
# rsync --delete를 사용하므로, skills-source/에서 삭제된 파일은 타겟에서도 제거된다.
# 단, skills-source/에 없는 다른 스킬들(Anthropic 기본 스킬 등)은 건드리지 않는다.
#

set -e

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)/skills-source"
TARGET_DIR="$HOME/.claude/skills"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ skills-source/ not found at $SOURCE_DIR"
    exit 1
fi

mkdir -p "$TARGET_DIR"

if command -v rsync >/dev/null 2>&1; then
    HAS_RSYNC=1
else
    HAS_RSYNC=0
    echo "ℹ️  rsync 없음 — cp -r 폴백 사용 (Windows Git Bash 등)"
    echo ""
fi

echo "📦 Installing skills from:"
echo "     $SOURCE_DIR"
echo "  →  $TARGET_DIR"
echo ""

count=0
for skill_path in "$SOURCE_DIR"/*/; do
    skill_name=$(basename "$skill_path")
    echo "  → $skill_name"
    if [ "$HAS_RSYNC" -eq 1 ]; then
        rsync -a --delete "$skill_path" "$TARGET_DIR/$skill_name/"
    else
        rm -rf "$TARGET_DIR/$skill_name"
        cp -r "$skill_path" "$TARGET_DIR/$skill_name"
    fi
    count=$((count + 1))
done

echo ""
echo "✅ Installed $count skills"
echo ""
echo "설치된 스킬들:"
ls -1 "$SOURCE_DIR" | sed 's/^/  • /'
