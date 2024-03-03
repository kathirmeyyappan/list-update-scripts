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
creds = ServiceAccountCredentials.from_json_keyfile_name('../credentials.json', scope)
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

urls = [url for url in sheet.col_values(12)[1:]]
old_scores = [float(n) for n in sheet.col_values(8)[1:]]
new_scores = [[]]
anime_names = sheet.col_values(3)[1:]
updates = []

## OLD METHOD, GETS RATE LIMITED

for i, url in enumerate(urls):
    
    id = re.search(r'/anime/(\d+)/?', url).group(1)
    mal_client_id = os.getenv('MAL_CLIENT_ID')
    mal_auth = {'X-MAL-CLIENT-ID' : mal_client_id}
    
    new_score = get_mal_rating(id, mal_auth)
    old_score = old_scores[i]
    sheet.update_cell(i + 2, 8, new_score)
    anime_name = anime_names[i]
    
    sp = 80 - len(anime_name)
    if float(old_score) != new_score:
        print(f"{anime_name}: {' ' * sp} {old_score} -> {new_score}")
    else:
        print(f"{anime_name}: {' ' * sp} no updates")
    
    sleep(0.5)
    
    
    
### ALT METHOD, STILL RATE LIMITED 

# for i, url in enumerate(urls):
    
#     id = re.search(r'/anime/(\d+)/?', url).group(1)
#     mal_client_id = os.getenv('MAL_CLIENT_ID')
#     mal_auth = {'X-MAL-CLIENT-ID' : mal_client_id}
    
#     new_score = get_mal_rating(id, mal_auth)
#     new_scores[0].append(new_score)    
#     old_score = old_scores[i]
#     if (old_score != new_score):
#         anime_name = anime_names[i]
#         sp = 80 - len(anime_name)
#         updates.append(f"{anime_name}: {' ' * sp} {old_score} -> {new_score}")
#         print(updates[-1])
    
#     if not i % 10:
#         print(f"{int(i / len(old_scores) * 100)}% done")

# print("ready?")
# sleep(10)
# sheet.update('H2:H', new_scores)
# print("done!")