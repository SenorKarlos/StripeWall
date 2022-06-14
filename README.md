# Discord Oauth2 Site Wall and Stripe Management

note: I can't reccomend enough a CDN like cloudflare with authenticated origin pull support, SSL, and DNSSEC. Provided NGINX example covers standard SSL config & www-> root redirects.

1: Pull Repo

2: Take oauth.php and insert into site root. Create directory oauth. Edit config.php.example and save to this folder as config.php.

3: Create Discord bot in Discord Developer Console (or use existing bot), and ensure it has administrative privileges in your server (assign roles and manage members minimum).

4: Fill out config.ini.example and remove '.example'. Create database per your config and run the SQL at the bottom to make the tables.

5: Add redirect_url from your completed config.ini to your Discord Bot. (/login URL)

6: Create a webhook in Stripe, add the following events to the stripe webhook, point to `https://<yourmap.com>/webhook`

`charge.refunded, customer.deleted, charge.succeeded, customer.subscription.created, customer.subscription.deleted, customer.subscription.updated, customer.updated, invoice.payment_failed`

7: Start the bot with PM2 `pm2 start wall.js`. Read the PM2 docs to have the bot automatically start as a service in the event of a power failure, restart, or other issue.

# FAQ:

What does this bot do?

- This bot gatekeeps a discord role and manages discord users with stripe subscriptions.

Does this bot take one-time payments?

- Not currently. I may add it in the future.

How does a user unsubscribe?

- Direct the user to your /subscribe URL, and they click "Unsubscribe". I may add a dedicated Unsubscribe page in the future.

Is payment information safe?

- The bot does not deal directly with any payment information. The payment html page uses the Stripe.js Checkout directly on their service platform. The bot receives a token sent by stripe to assign payment information to a Customer the bot creates. We do not need to worry about payment information security for this as is it all in the hands of Stripe.

How do I manually assign people a donor role so that the bot wont remove?

- Simply use a different role from your controlled role and configure your services accordingly, or have the user visit the subscribe link once to make an entry and change thier plan_id in the Database to 'Lifetime'.

How do I get the subscription plan_id?

- In Stripe Dashboard, go to Products > Click on the Product > Click on the Pricing Plan > Copy the ID from the Details section. Should look like plan_If7w44wkjh479Sdf or price_If7w44wkjh479Sdf depending on when the product was created and your API version.

How do I make a webhook?

- In Stripe Dashboard, click on the Developers section > Click Webhooks > Click Add Endpoint. Select the events defined above.

Can I manage users in Stripe Manually?

- Yes you can. The bot syncs with Stripe every 6 hours and also will manage users based on any webhooks it receives.

# Credits

Original Code/Concept by wragru
