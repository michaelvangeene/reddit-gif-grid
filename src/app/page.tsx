import { auth, signIn, signOut } from "@/auth";
import { LogIn, LogOut, LayoutGrid } from "lucide-react";
import GifGrid from "@/components/GifGrid";

export default async function Home() {
  const session = await auth();

  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      
      {session ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', padding: '0 1.5rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Your Upvoted GIFs</h1>
              <p style={{ color: '#aaa' }}>Logged in as {session.user?.name}</p>
            </div>
            
            <form
              action={async () => {
                "use server"
                await signOut()
              }}
            >
              <button type="submit" className="btn btn-outline">
                <LogOut size={18} />
                Sign Out
              </button>
            </form>
          </div>

          <GifGrid accessToken={session.accessToken as string} />
        </div>
      ) : (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '60vh',
          textAlign: 'center'
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: '3rem',
            borderRadius: '24px',
            border: '1px solid var(--border)',
            maxWidth: '500px',
            width: '100%'
          }}>
            <LayoutGrid size={48} color="var(--primary)" style={{ marginBottom: '1.5rem' }} />
            <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Welcome to GIF Grid</h1>
            <p style={{ color: '#aaa', marginBottom: '2rem', lineHeight: '1.6' }}>
              Connect your Reddit account to view all your upvoted GIFs and videos in a beautiful, infinite masonry grid.
            </p>
            
            <form
              action={async () => {
                "use server"
                await signIn("reddit")
              }}
            >
              <button type="submit" className="btn btn-primary" style={{ width: '100%', fontSize: '1.125rem' }}>
                <LogIn size={20} />
                Connect Reddit Account
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
