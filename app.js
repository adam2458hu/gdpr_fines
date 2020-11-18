//puppeteer csomag betöltése
const puppeteer = require('puppeteer');
//táblázattá konvertáláshoz szükséges csomag
const ObjectsToCsv = require('objects-to-csv');

function printGDPRData(){
	(async()=>{
		try {
			console.log("Adatok gyűjtése folyamatban");
			//böngésző indítása
			browser = await puppeteer.launch({'args' : [
			    '--no-sandbox',
			    '--disable-setuid-sandbox'
			]});

			//új lap nyitása
			let page = await browser.newPage();
			//azért, hogyha túl sokat töltene az oldal (30mp), akkor ne dobjon időtúllépés hibát
			await page.setDefaultNavigationTimeout(0);

			//1. index jelöli európa, 14 pedig magyarország adatait a privacy affairs szűrőjében
			let countryIndexes=[1,14];
			let countriesToScrape=['Európa','Magyarország'];
			//Európa és MO. adatait tartalmazó tömb
			let countryObjects=[];
			//az adott ország adatait tartalmazó weboldal kiértékelése
			for(i=0;i<countryIndexes.length;i++){ 
				//navigálás a privacy affairs oldalára
				await page.goto('https://www.privacyaffairs.com/gdpr-fines/',{waitUntil: 'networkidle0'});
				//büntetések csökkenő sorrendbe állítása
				await page.click('.priceFiltersDesc');
				//adott országra való szűrés
				await page.click(`ul.c-list li:nth-child(${countryIndexes[i]})`);

				//oldal kiértékelése
				let scrapedPage = await page.evaluate(async({countriesToScrape,i})=>{
					//várunk 10 mp-et hogy betöltődjön az oldalon minden script
					await new Promise(function(resolve) { 
				           setTimeout(resolve, 10000)
				    });

					//az egyes hatósági ügyek HTML blokkjai
					let authorityCaseHTMLBlocks = Array.from(document.querySelectorAll('#content__wrapper .item'),element=>element.innerHTML);
					//egy egyes hatósági ügyek büntetése
					let fines = [];
					//az egyes hatósági ügyek dátuma
					let datesOfViolations = [];
					//az egyes hatósági ügyek során megsértett cikkek
					let articlesViolated = [];
					for(j=0;j<authorityCaseHTMLBlocks.length && j<30;j++){
						let currentCase = document.createElement("div");
						currentCase.innerHTML = authorityCaseHTMLBlocks[j];
						let countryOfCase = (currentCase.querySelector('p:nth-child(2)').innerText).replace('Country: ','');
						let dateOfViolation = currentCase.querySelector('p:nth-child(4)').innerText;
						let fine = currentCase.querySelector('p:nth-child(5)').innerText;
						let articleViolated = currentCase.querySelector('p:nth-child(7) a');
						if (!articleViolated) {
							articleViolated = currentCase.querySelector('p:nth-child(7)').innerText;
						} else {
							articleViolated = articleViolated.innerText;
						}

						if (!(countriesToScrape[i]=="Európa" && countryOfCase=="Hungary")) {
							datesOfViolations.push(dateOfViolation.substring(6,dateOfViolation.length));
							fines.push(parseInt(fine.substring(7,fine.length).replace(/\s/g,'')));
							articlesViolated.push(articleViolated);
						}
					}

					return {
						datesOfViolations,
						fines,
						articlesViolated
					}
				},{countriesToScrape,i});

				console.log(scrapedPage.fines.sort(function(a,b){return a<b?1:-1}))
				/*az egyes cikkek mellől az "a)" "b)" stb sztringek kiszűrése regex kifejezéssel*/
				let allArticlesViolatedByCase=[];
				scrapedPage.articlesViolated.forEach(articleViolated=>{
					allArticlesViolatedByCase.push(articleViolated.match(/Art.\s?[0-9]+/g));
				});

				/*mivel egy cikknek több pontja is lehet [a) b)], ezért egy ügy esetében 
				 csak egyszer számoltam egy adott számú cikket*/
				let uniqueArticlesViolatedByCase=[];
				allArticlesViolatedByCase.forEach(articles=>{
					articles.forEach(article=>{
						if (!uniqueArticlesViolatedByCase.includes(article)) {
							uniqueArticlesViolatedByCase.push(article);
						}
					})
				})

				/* az egyes büntetések dátumát, értékét, és az adott dátumig felgyűlt összes
				 büntetések értékét tartalmazó objektumok tömbje*/
				let fineObjects=[];
				scrapedPage.datesOfViolations.forEach((date,index,arr)=>{
					fineObjects.push({
						date: date,
						fine: scrapedPage.fines[index],
						totalFineToDate: 0
					})
				})

				/* a büntetések rendezése dátum szerint növekvő sorrendben */
				fineObjects.sort(function(a,b){
					if (new Date(a.date) < new Date(b.date)) return -1;
					else return 1;
				})
				// az adott büntetés dátumáig felgyűlt összes büntetések értékének rögzítése az objektumokba
				fineObjects.forEach((data,index,arr)=>{
					if (index>0){
						data.totalFineToDate += data.fine+arr[index-1].totalFineToDate;
					} else {
						data.totalFineToDate = data.fine;
					}
				})

				/*az adott cikk nevét, összes büntetését, előfordulási számát
				 tartalmazó objektumok tömbje*/
				let articleObjects=[];
				uniqueArticlesViolatedByCase.forEach(article=>{
					let articleOccurence=0;
					allArticlesViolatedByCase.forEach((articles,index,arr)=>{
						if (articles.includes(article)) articleOccurence+=1;
					})
					articleObjects.push({
						name: article,
						occurence: articleOccurence
					});
				})

				countryObjects.push({articleObjects: articleObjects,fineObjects: fineObjects});
			}

			//az összes országban történt eseteket összeadva a legtöbbször megsértett cikkek száma
			let mostViolatedArticlesByAllCountry = [];
			countryObjects.forEach(country=>{
				country.articleObjects.forEach(article=>{
					// egyedi cikkek kigyűjtése
					if (mostViolatedArticlesByAllCountry.filter(articleObject=>{return articleObject.name==article.name}).length==0) {
						mostViolatedArticlesByAllCountry.push({name: article.name,occurence: article.occurence});
					} 
					// vagy a már kigyűjtött cikk előfordulási számának növelése
					else {
						mostViolatedArticlesByAllCountry.filter(articleObject=>{return articleObject.name==article.name})[0].occurence+=article.occurence;
					}
				})
			})
			
			/*az összes cikk rendezése előfordulási szám szerint csökkenő sorba
				vagy ha két előfordulás egyenlő, akkor a cikk sorszáma alapján növekvő sorrendbe*/
			mostViolatedArticlesByAllCountry.sort(function(a,b){
				if (a.occurence > b.occurence) return -1;
				else if (a.occurence < b.occurence) return 1;
				else if (a.name > b.name) return 1;
				else if (a.name < b.name) return -1;
			});
			console.log("Az egyes cikkek összes előfordulási száma: ");
			exportIntoCsv("most_violated_articles_by_all_country",mostViolatedArticlesByAllCountry);
			mostViolatedArticlesByAllCountry.forEach(article=>{
				console.log(article);
			})
			console.log("\n");

			// adott ország esetén az egyes cikkek előfordulási száma
			countryObjects.forEach((country,index,arr)=>{
				let tempArray=[];
				console.log(countriesToScrape[index]+" esetén az egyes cikkek előfordulási száma");
				mostViolatedArticlesByAllCountry.forEach(currentArticle=>{
					if (country.articleObjects.filter(articleObject=>{return articleObject.name==currentArticle.name}).length>0) {
						let articleFound=country.articleObjects.filter(articleObject=>{return articleObject.name==currentArticle.name})[0];
						tempArray.push(articleFound);
						console.log(articleFound);
					}
				})
				exportIntoCsv("most_violated_articles_in_"+countriesToScrape[index].toLowerCase(),tempArray);
				if (index!==arr.length-1) console.log("\n")
			})
			console.log("\n");
			
			//A Magyarországon eddig kiszabott büntetések alakulása
			console.log("A Magyarországon eddig kiszabott büntetések alakulása: ");
			exportIntoCsv("fines_to_date_in_hungary",countryObjects[1].fineObjects);
			countryObjects[1].fineObjects.forEach(fine=>{
				console.log(fine);
			})
			console.log("\n");
			console.log("Adatok gyűjtése és kiiratása befejezve");
			debugger;

			await browser.close();
		} catch(err){
			console.log(err);
		}
	})();
}

async function exportIntoCsv(fileName,data){
	try {
		const csv = new ObjectsToCsv(data);
	  	await csv.toDisk(`./exports/${fileName}.csv`);
	} catch(err){
		console.log(err);
	}
}

printGDPRData();