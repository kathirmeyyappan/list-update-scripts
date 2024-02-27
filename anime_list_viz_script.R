# packages and data import
library(ggplot2)
library(estimatr)
dat <- read.csv("C:/Users/kathi/Downloads/anime_ratings.csv")

# clean data
dat$mal_rating <- as.double(dat$mal_rating)
dat <- dat[complete.cases(dat), ]
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


# scatter plot of MAL ratings vs my ratings
# includes point heat for release year and size for watch year
ggplot(dat, aes(x = mal_rating, y = rating, fill = release_year, size = watch_year)) +
  geom_point(shape = 21, color = "black", alpha=0.6) +  
  geom_smooth(method = "lm", se = FALSE, color = "#10aaff") + 
  scale_shape(limits = c(NA, NA)) +
  scale_fill_gradientn(colors = c("red", "red", "yellow"), limits = c(NA, NA)) +  
  scale_size_continuous(range = c(3, 1)) + 
  labs(x = "MAL Rating", y = "My Rating", title = "MyAnimeList vs My Ratings for Franchises") +
  theme_minimal() +
  guides(size = guide_legend(keywidth = 0, override.aes = list(colour = "gray")) )
  