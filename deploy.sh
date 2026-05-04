set -e  # 🔥 stops script immediately on error

echo "🚀 Pushing to current branch..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 🔥 This is the critical line — if this fails, script stops
git push origin $CURRENT_BRANCH

echo "✅ Git push successful — continuing deployment..."

# Now only runs if push succeeded
echo "📦 Building app..."
pnpm run build
