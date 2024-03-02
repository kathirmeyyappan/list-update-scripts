# packages and data import
library(ggplot2)
library(estimatr)
dat <- read.csv("C:/Users/kathi/Downloads/anime_ratings.csv")

# clean data
dat$mal_rating <- as.double(dat$mal_rating)
dat <- dat[complete.cases(dat), ]
dat$anime_name <- gsub(" \\*", "", dat$anime_name)


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