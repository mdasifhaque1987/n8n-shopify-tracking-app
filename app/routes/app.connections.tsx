import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  // Get platform connection statuses from database
  // This is a placeholder - you'll need to implement the actual database queries
  const connections = {
    google: { connected: false, accountName: null },
    meta: { connected: false, accountName: null },
    tiktok: { connected: false, accountName: null },
    pinterest: { connected: false, accountName: null },
    microsoft: { connected: false, accountName: null },
    linkedin: { connected: false, accountName: null },
  };
  
  return { connections };
}

export default function ConnectionsPage() {
  const { connections } = useLoaderData<typeof loader>();

  const platforms = [
    {
      id: 'google',
      name: 'Google',
      description: 'Connect Google Analytics, Google Ads, and Google Merchant Center',
      icon: '🔵',
      oauthUrl: '/api/oauth/google-init',
    },
    {
      id: 'meta',
      name: 'Meta (Facebook)',
      description: 'Connect Facebook Pixel, Instagram, and Meta Business',
      icon: '📘',
      oauthUrl: '/api/oauth/meta-init',
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      description: 'Connect TikTok Pixel and TikTok Ads',
      icon: '🎵',
      oauthUrl: '/api/oauth/tiktok-init',
    },
    {
      id: 'pinterest',
      name: 'Pinterest',
      description: 'Connect Pinterest Tag and Pinterest Ads',
      icon: '📌',
      oauthUrl: '/api/oauth/pinterest-init',
    },
    {
      id: 'microsoft',
      name: 'Microsoft Ads',
      description: 'Connect Bing UET and Microsoft Advertising',
      icon: '🪟',
      oauthUrl: '/api/oauth/microsoft-init',
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      description: 'Connect LinkedIn Insight Tag and LinkedIn Ads',
      icon: '💼',
      oauthUrl: '/api/oauth/linkedin-init',
    },
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1200 }}>
      <h1>Platform Connections</h1>
      <p style={{ marginBottom: 24, color: '#666' }}>
        Connect your advertising platforms to enable server-side tracking,
        enhanced conversions, and automated audience sync.
      </p>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: 16 
      }}>
        {platforms.map((platform) => {
          const connection = connections[platform.id as keyof typeof connections];
          const isConnected = connection?.connected;

          return (
            <div
              key={platform.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 16,
                backgroundColor: isConnected ? '#f0f9ff' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 32, marginRight: 12 }}>{platform.icon}</span>
                <div>
                  <h3 style={{ margin: 0 }}>{platform.name}</h3>
                  {isConnected && connection.accountName && (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
                      Connected: {connection.accountName}
                    </p>
                  )}
                </div>
              </div>
              
              <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                {platform.description}
              </p>

              <div style={{ display: 'flex', gap: 8 }}>
                {!isConnected ? (
                  <a
                    href={platform.oauthUrl}
                    style={{
                      display: 'inline-block',
                      padding: '8px 16px',
                      backgroundColor: '#4F46E5',
                      color: 'white',
                      textDecoration: 'none',
                      borderRadius: 4,
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    Connect {platform.name}
                  </a>
                ) : (
                  <>
                    <span style={{
                      padding: '8px 16px',
                      backgroundColor: '#10B981',
                      color: 'white',
                      borderRadius: 4,
                      fontSize: 14,
                      fontWeight: 500,
                    }}>
                      ✓ Connected
                    </span>
                    <button
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#EF4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ 
        marginTop: 32, 
        padding: 16, 
        backgroundColor: '#FFF7ED', 
        borderRadius: 8,
        border: '1px solid #FDBA74'
      }}>
        <h3 style={{ margin: '0 0 8px', color: '#EA580C' }}>🔐 OAuth Authentication</h3>
        <p style={{ margin: 0, fontSize: 14, color: '#9A3412' }}>
          Clicking "Connect" will open a new window to authenticate with the platform.
          After successful authentication, you'll be redirected back to this page.
          Your credentials are securely encrypted and stored.
        </p>
      </div>
    </div>
  );
}
