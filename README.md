# Discord Oauth2 Based Stripe-Role Management

note: I can't reccomend enough a CDN like cloudflare with authenticated origin pull support, SSL, and DNSSEC.

- Pull Repo, `npm install`. Create a MySql database (or add to existing) and run the database.sql file to make the user table.

- Create Discord bot in Discord Developer Console (or use existing bot), and ensure it has administrative privileges in your server (assign roles and manage members minimum).

- Fill out config.json.example and remove '.example'. Use the NGINX example to copy location redirects to your current site. Match the port in the redirects to the one specified in config, and copy a permanent discord invite URL to the last item. (Apache info needed, I don't use it)

- Add redirect_url from your completed config.json to your Discord Bot. (/login URL)

- Create a webhook in Stripe, add the following events to the stripe webhook, point to `https://<yourmap.com>/webhook`

`charge.refunded, charge.succeeded, checkout.session.completed, customer.created, customer.deleted, customer.updated, customer.subscription.deleted, customer.subscription.updated`

- Start the bot with PM2 `pm2 start wall.js`. Read the PM2 docs to have the bot automatically start as a service in the event of a power failure, restart, or other issue.

# General Information:

- This bot gatekeeps discord roles and manages discord users with stripe subscriptions, Lifetime Roles & manually tracked (ie. cash payments).

- All account management is done via /login and Stripe Customer Checkout/Portal. One-Time, Manually Tracked and Lifetime users will see a static page with expiry dates, Stripe customers will be presented with the Management Portal, and new customers or those within a day of expiry are shown your configured checkout options.

- The bot does not deal directly with any payment information. All information is entered and updated on Stripe hosted pages. The bot receives tokens sent by Stripe to track current plans or the last one-time purchase made.

- User Identification in the database is as follows:
 - "Lifetime" manual = true, temp_plan_expiration = 9999999999
 - "Manually Tracked" manual = true, temp_plan_expiration = <insert unix timestamp of expiry>
 - "One Time" (set by bot) manual = false, temp_plan_expiration = unix expiry calced by bot

How do I get the subscription plan_id?

- In Stripe Dashboard, go to Products > Click on the Product > Click on the Price > Copy the ID from the Details section. Should look like plan_If7w44wkjh479Sdf or price_If7w44wkjh479Sdf depending on when the product was created and your API version.

How do I make a webhook?

- In Stripe Dashboard, click on the Developers section > Click Webhooks > Click Add Endpoint. Select the events defined above.

Can I manage users in Stripe Manually?

- Yes you can. The bot syncs with Stripe every 6 hours and also will manage users based on any webhooks it receives.

# Credits

Original Code/Concept by wragru
