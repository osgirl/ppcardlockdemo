# Card Lock Node.js Demo

This is a simple demo that shows PayPoint's CardLock product being used in conjunction with the PayPoint Advanced Payments API
on a node.js server.

# Running the demo
First ensure that dependencies are installed:

    npm install


## Configure the app

Create a config.json file based  on the included config.json.example:


	{
	   "pp_api_user":<API user ID in quotes>
	   "pp_api_secret":<API secret in quotes>,
	   "pp_api_installation":<installation id in quotes>,
	   "pp_cardlock_publishableid":<publishable id in quotes>,
	   "pp_env" : <"MITE" or "LIVE">
	}

* pp_api_user : your PayPoint API user ID
* pp_api_secret : your PayPoint API secret
* pp_api_installation : your API installation ID
* pp_cardlock_publishableid: your cardlock publishable ID (this can be embedded in your page HTML)
* pp_env : "MITE" (testing) or "LIVE" (real)

## Running the app

The demo consists of a single service  which can can be run from node,

    node ./server.js

Then point your browser at localhost:5000