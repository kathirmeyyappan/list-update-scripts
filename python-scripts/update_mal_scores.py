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

# MAL auth
mal_client_id = os.getenv('MAL_CLIENT_ID')
mal_auth = {'X-MAL-CLIENT-ID' : mal_client_id}

# arrays for use, cmp, and update
urls = [url for url in sheet.col_values(12)[1:]]
old_scores = [float(n) for n in sheet.col_values(8)[1:]]
new_scores = [[]]
anime_names = sheet.col_values(3)[1:]
updates = []
score_map = {}


# function to get the score of the anime with given id
def get_mal_rating(anime_id):
    base_url = "https://api.myanimelist.net/v2/anime"
    response = requests.get(f'{base_url}/{anime_id}?fields=,mean', 
                            headers=mal_auth).json()
    return response['mean']


# initial MAL API call
url = "https://api.myanimelist.net/v2/users/Uji_Gintoki_Bowl/animelist?fields=,mean"
payload = {'limit': 500,
           'offset': 0,
           'fields': 'id, mean'}
response = requests.get(url, headers=mal_auth, params=payload).json()

# populate score_map to cache scores and avoid 100s of calls
while True:
    
    for obj in response['data']:
        entry = obj['node']
        id = str(entry['id'])
        score = entry.get('mean', 'NA')
        score_map[id] = score
    
    if 'next' not in response['paging']:
        break
    response = requests.get(response['paging']['next'], headers=mal_auth).json()
    
    
# make new_scores
for i, url in enumerate(urls):
    
    id = re.search(r'/anime/(\d+)/?', url).group(1)
    new_score = get_mal_rating(id) if id not in score_map else score_map[id]
    new_scores[0].append(new_score)
    old_score = old_scores[i]
    
    if (old_score != new_score):
        anime_name = anime_names[i]
        sp = 80 - len(anime_name)
        updates.append(f"{anime_name}: {' ' * sp} {old_score} -> {new_score}")

# print updates
for i, msg in enumerate(updates):
    if i == 0:
        print("\nUPDATES:\n")
    print(msg)

# sync to MAL rating column in sheet
mal_rating_column = sheet.range(f'H2:H{2 + len(new_scores[0]) - 1}')
for i, cell in enumerate(mal_rating_column):
    cell.value = new_scores[0][i]
sheet.update_cells(mal_rating_column)
