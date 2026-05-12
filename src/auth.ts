import NextAuth from "next-auth"
import Reddit from "next-auth/providers/reddit"

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Reddit({
      clientId: process.env.AUTH_REDDIT_ID as string,
      clientSecret: process.env.AUTH_REDDIT_SECRET as string,
      authorization: {
        url: "https://old.reddit.com/api/v1/authorize",
        params: {
          duration: 'permanent',
          scope: 'identity history read',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      return session
    }
  },
  debug: true,
})
