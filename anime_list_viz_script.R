# packages and data import
library(ggplot2)
library(estimatr)
dat <- read.csv("C:/Users/kathi/Downloads/anime_ratings.csv")

# clean data
dat$highest_mal_rating <- as.double(dat$highest_mal_rating)
dat <- dat[complete.cases(dat), ]
dat$anime_name <- gsub(" \\*", "", dat$anime_name)


# histogram of release and watch years
chrono_data <- data.frame(Source = c(rep("Watch Year", length(dat$watch_year)), 
                                      rep("Release Year", length(dat$release_year))),
                           Ratings = c(dat$watch_year, dat$release_year))
ggplot(chrono_data, aes(x = Ratings, fill = Source)) +
  geom_histogram(color = "black", alpha = 0.5, binwidth = 1, position = "identity") +
  labs(x = "Year", y = "Frequency", title = "Distribution of Watch/Release Years") +
  scale_fill_manual(values = c("Watch Year" = "#0099cc", "Release Year" = "#6600cc")) +
  theme_minimal()


# histogram of my and MyAnimeList ratings
ratings_data <- data.frame(Source = c(rep("My Ratings", length(dat$rating)), 
                                      rep("MAL Ratings", length(dat$highest_mal_rating))),
                           Ratings = c(dat$rating, dat$highest_mal_rating))
# create overlapped density plots
ggplot(ratings_data, aes(x = Ratings, fill = Source)) +
  geom_density(alpha = 0.4) +
  labs(x = "Score", y = "Frequency", title = "Rating Distributions (Me vs MyAnimeList)") +
  scale_fill_manual(values = c("My Ratings" = "green", "MAL Ratings" = "yellow")) +
  theme_minimal()