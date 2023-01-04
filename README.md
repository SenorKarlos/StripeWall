# Discord Oauth2 Based Stripe-Role Management

- I can't reccomend enough a CDN like CloudFlare with authenticated origin pull support, SSL, and DNSSEC.

- Pull Repo, `npm install`. Create a MySql database and run the database.sql file (or add to existing) to make the user table.

- Create/Reuse a Discord bot in the Discord Developer Console. It will require a Bot presence and the Guild Members Intent. Ensure it can manage the roles you want and post messages to the log & welcome channels (I'm lazy and use Admin lol).

- Copy `config.json.example` to `config.json` and fill out using CONFIG.md guide. Use the NGINX example to copy location redirects to your current site. Match the port in the redirects to the one specified in config, and copy a permanent discord invite URL to the last item.
(Apache example needed, I don't use it)

- Add redirect_url from your completed config.json to your Discord Bot. (/login URL)

- Create a webhook in Stripe, add the following events to the stripe webhook, point to `https://<yoursite.com>/webhook`

`charge.refunded, charge.succeeded, checkout.session.completed, customer.created, customer.deleted, customer.updated, customer.subscription.deleted, customer.subscription.updated`

- Start the bot with PM2 `pm2 start wall.js` or by adding to your ecosystem. My configuration is as shown, I like one logfile but the others are the most important. If your PM2 does not already auto-start with your OS, you should consult the PM2 Documents.

```
    {
      name: 'StripeWall',
      script: 'wall.js',
      cwd: '/home/username/StripeWall/',
      instances: 1,
      out_file: '/home/username/.pm2/logs/StripeWall.log',
      error_file: '/home/username/.pm2/logs/StripeWall.log',
      autorestart: true,
      watch: true
    }
```

# General Information:

- This bot gatekeeps discord roles and manages discord users with Stripe Purchases & Subscriptions, Active & Inactive Lifetime Roles, and Manual User Tracking (ie. cash payments, prize wins, etc).

- All account management is done via /login and Stripe Hosted Checkout & Customer Portal. One-Time & Manually Tracked users will see a static page with expiry dates, Lifetime Users have an Active/Inactive toggle, Stripe customers will be presented with the Management Portal, and new customers or those within a day of expiry are shown your configured checkout options.

- User Identification in the database is as follows:
"Active Lifetime": manual = true, temp_plan_expiration = 9999999999
"Inactive Lifetime": manual = true, temp_plan_expiration = 9999999998
"Manually Tracked": manual = true, temp_plan_expiration = unix timestamp of expiry
"One Time" (set by bot): price_id = configured price, manual = false, temp_plan_expiration = unix expiry calced by bot
"Subscriber" (set by bot): price_id = configured price, manual = false, temp_plan_expiration = null

- The bot does not deal directly with any payment information. All information is entered and updated on Stripe hosted pages. The bot receives tokens sent by Stripe to track current plans or the last one-time purchase made.

#Q&A

How do I get the price_id's?

- In Stripe Dashboard, go to Products > Click on the Product > Click on the Price > Copy the ID from the Details section. Should look like plan_If7w44wkjh479Sdf or price_If7w44wkjh479Sdf depending on when the product was created and your API version.

How do I make a webhook?

- In Stripe Dashboard, click on the Developers section > Click Webhooks > Click Add Endpoint. Select the events defined above.

Can I manage users in Stripe Manually?

- Yes you can. The bot syncs with Stripe every 6 hours by default (configurable) and also will manage users based on any webhooks it receives.

# Credits

Original Code/Concept by wragru
versx, Jabes and anyone else who answered my Node questions
the Dev help team at Stripe