# packages and data import
library(ggplot2)
library(googlesheets4)


# Authenticate with Google Sheets using JSON credentials and import data
gs4_auth(path = "C:\\Users\\kathi\\Downloads\\credentials.json")
dat <- read_sheet(paste("https://docs.google.com/spreadsheets/d/1MCPi0GCz_",
                  "YrLal50ey09ZvOqXGf8FH23XMC1TeP2etA/edit#gid=618528452"),
                  range = ".csv Anime List Mirror")
dat <- as.data.frame(dat)


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