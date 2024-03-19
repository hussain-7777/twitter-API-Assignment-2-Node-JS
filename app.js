const express = require('express')
const app = express()
app.use(express.json())
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
let db = null

const initDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}
initDBAndServer()

const getFollowingUserIds = async username => {
  const getFollowingUserIdsQuery = `select following_user_id from follower 
  inner join user on follower.follower_user_id = user.user_id 
  where user.username = '${username}';`
  const followingUserIds = await db.all(getFollowingUserIdsQuery)
  const followingUserIdsArray = followingUserIds.map(
    user => user.following_user_id,
  )
  return followingUserIdsArray
}

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params

  const getTweetQuery = `select * from tweet inner join follower on 
  tweet.user_id = follower.following_user_id where tweet_id = ${tweetId} and 
  follower_user_id = ${userId};`
  const tweet = await db.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

// API 1
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const getUserQuery = `select * from user where username = '${username}';`
  const user = await db.get(getUserQuery)
  if (user === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `insert into user (username, password, name, gender) 
    values ('${username}', '${hashedPassword}', '${name}', '${gender}');`
      const newUser = await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

// API 2
app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const getUserQuery = `select * from user where username = '${username}';`
  const user = await db.get(getUserQuery)
  if (user === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password)
    if (isPasswordMatched) {
      const payload = {username, userId: user.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// API 3 Returns the latest tweets of people
// whom the user follows. Return 4 tweets at a time
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const followingUserIds = await getFollowingUserIds(username)

  const getTweetsQuery = `select username, tweet, date_time as dateTime 
  from user inner join tweet on user.user_id = tweet.user_id 
  where user.user_id in (${followingUserIds})
  order by date_time desc limit 4;`
  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})

// API 4 Returns the list of all names of people whom the user follows
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username, userId} = request

  const getFollowingUsersQuery = `select name from user inner join follower on 
  user.user_id = follower.following_user_id where follower_user_id = ${userId};`
  const followingUsers = await db.all(getFollowingUsersQuery)
  response.send(followingUsers)
})

// API 5 Returns the list of all names of people who follows the user
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username, userId} = request

  const getFollowersQuery = `select name from follower inner join user on 
  user.user_id = follower.follower_user_id where following_user_id = ${userId};`
  const followers = await db.all(getFollowersQuery)
  response.send(followers)
})

// API 6
app.get(
  '/tweets/:tweetId',
  authenticateToken,
  // Scen 1 If the user requests a tweet other than the users he is following
  tweetAccessVerification,
  async (request, response) => {
    // Scen 2 If the user requests a tweet of the user he is following, return the
    // tweet, likes count, replies count and date-time
    const {tweetId} = request.params

    const getTweetQuery = `select tweet, 
    (select count() from like where tweet_id = ${tweetId}) as likes, 
    (select count() from reply where tweet_id = ${tweetId}) as replies, 
    date_time as dateTime from tweet 
    where tweet_id = ${tweetId};`
    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  },
)

// API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params

    const getTweetLikedUsersQuery = `select username from user inner join like on 
  user.user_id = like.user_id where tweet_id = ${tweetId};`
    let tweetLikedUsers = await db.all(getTweetLikedUsersQuery)
    tweetLikedUsersArray = tweetLikedUsers.map(user => user.username)
    response.send({likes: tweetLikedUsersArray})
  },
)

// API 8 If the user requests a tweet of a user he is following,
// return the list of replies.
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params

    const getUserRepliesQuery = `select name, reply from user inner join reply on 
  user.user_id = reply.user_id where tweet_id = ${tweetId};`
    const userReplies = await db.all(getUserRepliesQuery)
    response.send({replies: userReplies})
  },
)

// API 9 Returns a list of all tweets of the user
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request

  const getTweetsQuery = `select tweet, 
  count(distinct like_id) as likes, count(distinct reply_id) as replies, 
  date_time as dateTime from tweet left join reply on tweet.tweet_id = reply.tweet_id 
  left join like on tweet.tweet_id = like.tweet_id where tweet.user_id = ${userId} 
  group by tweet.tweet_id;`
  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})

// API 10 Create a tweet in the tweet table
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const {userId} = request
  const dateTime = null

  const createTweetQuery = `insert into tweet (tweet, user_id, date_time) 
  values ('${tweet}', '${userId}', '${dateTime}');`
  const newTweet = await db.run(createTweetQuery)
  response.send('Created a Tweet')
  console.log({newTweet})
})

// API 11
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const getTweetQuery = `select * from tweet where user_id = '${userId}' and 
    tweet_id = '${tweetId}';`
    const tweet = await db.get(getTweetQuery)

    if (tweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `delete from tweet where tweet_id = '${tweetId}';`
      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    }
  },
)

// API 12
app.get('/tweets/', async (request, response) => {
  const getTweetsQuery = `select * from tweet;`
  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})
module.exports = app
