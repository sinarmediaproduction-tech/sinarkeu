name: Keep Supabase Alive

on:
  schedule:
    # Jalankan setiap 3 hari sekali (Supabase pause setelah 7 hari inaktif)
    - cron: '0 3 */3 * *'
  workflow_dispatch: # Bisa dijalankan manual dari GitHub Actions tab

jobs:
  ping-supabase:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase REST API
        run: |
          echo "Pinging Supabase project..."
          
          RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
            "${{ secrets.SUPABASE_URL }}/rest/v1/" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}")
          
          echo "HTTP Status: $RESPONSE"
          
          if [ "$RESPONSE" -ge 200 ] && [ "$RESPONSE" -lt 500 ]; then
            echo "✅ Supabase aktif (status $RESPONSE)"
          else
            echo "⚠️  Respon tidak terduga: $RESPONSE"
            exit 1
          fi
