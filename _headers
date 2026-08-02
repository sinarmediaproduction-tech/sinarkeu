-- ============================================================
-- FITUR: Log kapan terakhir anggota (editor/viewer/admin) login
-- ke aplikasi, ditampilkan di panel "Kelola Anggota" / "Manajemen
-- User".
-- Jalankan SEKALI di Supabase SQL Editor -- SETELAH
-- sql/profiles_and_invite.sql (butuh tabel public.profiles).
-- ============================================================
--
-- KENAPA PAKAI RPC, BUKAN UPDATE LANGSUNG DARI CLIENT:
-- sql/profiles_and_invite.sql SENGAJA tidak membuka policy
-- UPDATE untuk role `authenticated` di public.profiles (supaya
-- user tidak bisa mengubah/memalsukan email profil orang lain
-- lewat REST API langsung). Supaya user tetap bisa "mencatat
-- login saya sendiri" tanpa membuka celah itu, dipakai fungsi
-- RPC SECURITY DEFINER yang HANYA mengizinkan user meng-update
-- baris miliknya sendiri (id = auth.uid()), dan HANYA kolom
-- last_login_at.
-- ============================================================

-- ── Kolom baru ───────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ── RPC: catat login user yang sedang memanggil ─────────────
-- Dipanggil dari window.skTouchLastLogin (js/auth.js) tiap kali
-- ada login eksplisit (skSignIn) atau sesi lama berhasil
-- dipulihkan (skRefreshSharedAccess, sekali per sesi tab).
CREATE OR REPLACE FUNCTION public.sk_touch_last_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN;
    END IF;
    UPDATE public.profiles
    SET last_login_at = now()
    WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.sk_touch_last_login() TO authenticated;

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - public.profiles.last_login_at terisi otomatis tiap user
--     login/buka app (lewat window.skTouchLastLogin).
--   - Kolom ini ikut terbaca policy profiles_select_authenticated
--     yang sudah ada (SELECT true untuk semua user login) --
--     TIDAK perlu policy select baru, sehingga admin bisa melihat
--     "terakhir login" semua anggota di panel Kelola Anggota.
-- ============================================================
