#!/bin/bash
# シークレット・機密情報の混入を検出
# changed-file guard から呼び出される

set -e

# 変更されたファイルを取得（引数として渡される）
FILES="$@"

if [ -z "$FILES" ]; then
  exit 0
fi

echo "🔒 Checking for secrets..."

FAILED=0

# 検出パターン定義（パターン名~正規表現~grep追加オプション）
# grep -E（拡張正規表現）を使用（macOS互換）
PATTERNS=(
  "AWS Access Key~AKIA[0-9A-Z]{16}~"
  "AWS Secret Key~aws_secret_access_key[[:space:]]*=[[:space:]]*['\"][A-Za-z0-9/+=]{40}~"
  "GCP Service Account Key~\"private_key\":[[:space:]]*\"-----BEGIN~"
  "GCP API Key~AIza[0-9A-Za-z_-]{35}~"
  "GitHub Token~gh[pousr]_[A-Za-z0-9_]{36}~"
  "Generic API Key~(api[_-]?key|apikey)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9]{20}~-i"
  "Generic Secret~(secret|password|passwd|pwd)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9/+=_-]{16}~-i"
  "Private Key~-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----~"
  "JWT Token~eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}~"
  "Slack Token~xox[bpors]-[0-9a-zA-Z-]{10}~"
  "Stripe Key~sk_live_[0-9a-zA-Z]{24}~"
  "SendGrid Key~SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}~"
)

for file in $FILES; do
  # ファイルが存在するか確認
  if [ ! -f "$file" ]; then
    continue
  fi

  # バイナリファイルは除外
  if file "$file" | grep -q "binary"; then
    continue
  fi

  # lockファイル・生成ファイルは除外
  if [[ "$file" == *"lock"* ]] || [[ "$file" == *".gen."* ]] || [[ "$file" == *"generated"* ]]; then
    continue
  fi

  # テスト用のモックデータは除外（テストファイル内の "password": "test" 等）
  IS_TEST=0
  if [[ "$file" =~ \.(test|spec)\.(ts|tsx|js|jsx)$ ]] || [[ "$file" == *"__tests__"* ]] || [[ "$file" == *"__mocks__"* ]]; then
    IS_TEST=1
  fi

  for pattern_entry in "${PATTERNS[@]}"; do
    # パターン名、正規表現、追加オプションを分離（~区切り）
    PATTERN_NAME="${pattern_entry%%~*}"
    REST="${pattern_entry#*~}"
    PATTERN_REGEX="${REST%%~*}"
    GREP_OPTS="${REST#*~}"

    # テストファイルではモックデータによる誤検知パターンをスキップ
    if [ $IS_TEST -eq 1 ]; then
      if [[ "$PATTERN_NAME" == "Generic Secret" ]] || [[ "$PATTERN_NAME" == "Generic API Key" ]] || [[ "$PATTERN_NAME" == "JWT Token" ]] || [[ "$PATTERN_NAME" == "Private Key" ]] || [[ "$PATTERN_NAME" == "GCP Service Account Key" ]] || [[ "$PATTERN_NAME" == "Slack Token" ]] || [[ "$PATTERN_NAME" == "AWS Access Key" ]] || [[ "$PATTERN_NAME" == "AWS Secret Key" ]]; then
        continue
      fi
    fi

    # .env.example はGenericパターンをスキップ（プレースホルダー値があるため）
    if [[ "$file" == *".env.example"* ]] || [[ "$file" == *".env.sample"* ]]; then
      if [[ "$PATTERN_NAME" == "Generic Secret" ]] || [[ "$PATTERN_NAME" == "Generic API Key" ]]; then
        continue
      fi
    fi

    # db-configs*.ts はSecret Manager参照名のみ（実際のシークレット値ではない）
    if [[ "$file" == *"db-configs"*".ts"* ]] || [[ "$file" == *"db-configs"*".js"* ]]; then
      if [[ "$PATTERN_NAME" == "Generic Secret" ]]; then
        continue
      fi
    fi

    # infra/ 配下のPulumiファイルはsecretKeyRef参照のみ（実際のシークレット値ではない）
    if [[ "$file" == *"infra/"* ]] && [[ "$file" == *".ts" ]]; then
      if [[ "$PATTERN_NAME" == "Generic Secret" ]]; then
        continue
      fi
    fi

    # grep -E（拡張正規表現）で検索（-e でパターンを明示指定）
    MATCH=""
    if [ -n "$GREP_OPTS" ]; then
      MATCH=$(grep -En $GREP_OPTS -e "$PATTERN_REGEX" "$file" 2>/dev/null | head -3) || true
    else
      MATCH=$(grep -En -e "$PATTERN_REGEX" "$file" 2>/dev/null | head -3) || true
    fi

    if [ -n "$MATCH" ]; then
      echo "  ❌ $file: $PATTERN_NAME detected"
      echo "$MATCH" | while IFS= read -r line; do
        echo "     $line"
      done
      FAILED=1
    fi
  done
done

if [ $FAILED -eq 1 ]; then
  echo ""
  echo "❌ Secret check failed."
  echo ""
  echo "機密情報がコードに含まれています。"
  echo "環境変数または Secret Manager を使用してください。"
  echo ""
  echo "誤検知の場合は、パターンを scripts/hooks/secret-check.sh で確認してください。"
  exit 1
fi

echo "✓ No secrets detected"
