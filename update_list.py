# self note: cred info is in AnimeListUpdate project in gcloud console

import os
import dotenv
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import requests
import re
from time import sleep

dotenv.load_dotenv()

# connect to Google Sheets
scope = ['https://spreadsheets.google.com/feeds',
         'https://www.googleapis.com/auth/drive']
creds = ServiceAccountCredentials.from_json_keyfile_name('./credentials.json', scope)
client = gspread.authorize(creds)

# accessing relevant tab in sheet
sheet_key = os.getenv('SHEET_KEY')
sheet = client.open_by_key(sheet_key).worksheet('Anime List (Statistics Version)')

# function to get the score of the anime with given id
def get_mal_rating(anime_id, mal_auth):
    base_url = "https://api.myanimelist.net/v2/anime"
    response = requests.get(f'{base_url}/{anime_id}?fields=,mean', 
                            headers=mal_auth).json()
    return response['mean']

# populate scores for each row
for i, hyperlink in enumerate(sheet.col_values(12)):
    if i == 0:
        continue
    
    id = re.search(r'/anime/(\d+)/?', hyperlink).group(1)
    mal_client_id = os.getenv('MAL_CLIENT_ID')
    mal_auth = {'X-MAL-CLIENT-ID' : mal_client_id}
    score = get_mal_rating(id, mal_auth)
    
    sheet.update_cell(i + 1, 8, score)
    anime_name = sheet.col_values(3)[i]
    print(f'{i}. {anime_name} MAL score updated')
    sleep(0.5)

print("done!")
