# packages and data import
library(ggplot2)
library(googlesheets4)


# Authenticate with Google Sheets using JSON credentials and import data
gs4_auth(path = "C:\\Users\\kathi\\Downloads\\credentials.json")
dat <- read_sheet(paste("https://docs.google.com/spreadsheets/d/1MCPi0GCz_",
                  "YrLal50ey09ZvOqXGf8FH23XMC1TeP2etA/edit#gid=618528452"),
                  range = ".csv Anime List Mirror")
dat <- as.data.frame(dat)


# clean data
dat$mal_rating <- as.double(dat$mal_rating)
dat$anime_name <- gsub(" \\*", "", dat$anime_name)


# discrete histogram of release and watch years
chrono_data <- data.frame(Source = c(rep("Watch Year", length(dat$watch_year)), 
                                     rep("Release Year", length(dat$release_year))),
                          Ratings = c(dat$watch_year, dat$release_year))
ggplot(chrono_data, aes(x = Ratings, fill = Source)) +
  geom_histogram(color = "black", alpha = 0.5, binwidth = 1, position = "identity") +
  labs(x = "Year", y = "Frequency", title = "Distribution of Watch/Release Years") +
  scale_fill_manual(values = c("Watch Year" = "#0099cc", "Release Year" = "#6600cc")) +
  theme_minimal()


# smooth histogram of my and MyAnimeList ratings
ratings_data <- data.frame(Source = c(rep("My Ratings", length(dat$rating)), 
                                      rep("MAL Ratings", length(dat$mal_rating))),
                           Ratings = c(dat$rating, dat$mal_rating))
ggplot(ratings_data, aes(x = Ratings, fill = Source)) +
  geom_density(alpha = 0.4) +
  labs(x = "Score", y = "Frequency", title = "Rating Distributions (Me vs MyAnimeList)") +
  scale_fill_manual(values = c("My Ratings" = "green", "MAL Ratings" = "yellow")) +
  theme_minimal()